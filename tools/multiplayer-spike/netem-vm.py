"""A RAM-only Alpine VM for packet-level TCP impairment on a Windows host.

No host adapters, drivers, system install, elevation, or port exposure beyond
127.0.0.1. Run netem-bootstrap.py first. Ctrl+C shuts down the child VM.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

CACHE = Path(os.environ["LOCALAPPDATA"]) / "carwars-netem"


class Console:
    def __init__(self):
        self.socket = socket.create_connection(("127.0.0.1", 2599), timeout=10)
        self.socket.settimeout(.2)
        self.buffer = ""

    def send(self, command):
        self.socket.sendall((command + "\n").encode())

    def until(self, marker, timeout=90):
        deadline = time.monotonic() + timeout
        while marker not in self.buffer:
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Console waiting for {marker!r}: {self.buffer[-1500:]}")
            try:
                data = self.socket.recv(65536)
                if not data:
                    raise ConnectionError("VM console closed")
                self.buffer += data.decode(errors="replace")
                (CACHE / "serial-tail.txt").write_text(self.buffer[-4000:], encoding="utf8")
            except socket.timeout:
                pass
        result, self.buffer = self.buffer.split(marker, 1)
        return result

    def command(self, command, timeout=120):
        marker = "VM_COMMAND_FINISHED_" + str(time.monotonic_ns())
        # Split marker prevents matching the echoed command before execution.
        half = len(marker) // 2
        self.send(command + "\nvm_status=$?; printf '\\n%s%s:%s\\n' '" + marker[:half] + "' '" + marker[half:] + "' \"$vm_status\"")
        result = self.until(marker, timeout)
        status = self.until("\n", 10).strip().lstrip(":")
        if status != "0":
            raise RuntimeError(f"Guest command failed ({status}): {command}\n{result[-1000:]}")
        return result


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--rtt", type=int, default=100)
    parser.add_argument("--jitter", type=int, default=20)
    parser.add_argument("--loss", type=float, default=1)
    args = parser.parse_args()
    if not 0 <= args.rtt <= 2000 or not 0 <= args.jitter <= 1000 or not 0 <= args.loss <= 10:
        raise ValueError("Impairment outside test limits")
    config = json.loads((CACHE / "manifest.json").read_text(encoding="utf8"))
    command = [config["qemu"], "-machine", "pc,accel=tcg", "-m", "768", "-smp", "2",
               "-display", "none", "-monitor", "none", "-no-reboot",
               "-serial", "tcp:127.0.0.1:2599,server=on,wait=off",
               "-kernel", config["kernel"], "-initrd", config["initrd"], "-cdrom", config["iso"],
               "-append", "console=ttyS0,115200 modules=loop,squashfs,sd-mod,sr-mod quiet alpine_dev=sr0",
               "-netdev", "user,id=n0,hostfwd=tcp:127.0.0.1:2581-:2577", "-device", "e1000,netdev=n0"]
    log = (CACHE / "qemu.log").open("wb")
    process = subprocess.Popen(command, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
    console = None
    try:
        for _ in range(100):
            try:
                console = Console(); break
            except (OSError, ConnectionError):
                if process.poll() is not None:
                    raise RuntimeError((CACHE / "qemu.log").read_text(errors="replace"))
                time.sleep(.2)
        if console is None:
            raise RuntimeError("QEMU serial console did not listen")
        print(console.until("login:", timeout=120)[-1200:], flush=True)
        console.send("root")
        print(console.until("localhost:~#", timeout=30)[-500:], flush=True)
        console.command("export TERM=dumb; stty -echo")
        print(console.command("ip link set eth0 up && udhcpc -i eth0 -q -n -t 5 && printf 'http://dl-cdn.alpinelinux.org/alpine/v3.22/main\\n' > /etc/apk/repositories && apk add --no-progress --quiet iproute2 iproute2-tc socat", timeout=120)[-2000:], flush=True)
        setup = "modprobe sch_netem; socat TCP-LISTEN:2577,reuseaddr,fork TCP:10.0.2.2:2577 >/tmp/socat.log 2>&1 &"
        print(console.command(setup)[-600:], flush=True)
        impairment = f"tc qdisc replace dev eth0 root netem delay {args.rtt / 2:g}ms {args.jitter / 2:g}ms loss {args.loss:g}%"
        print(console.command(impairment + "; tc -s qdisc show dev eth0; grep -A1 '^Tcp:' /proc/net/snmp")[-1400:], flush=True)
        print("NETEM_READY http://127.0.0.1:2581 -> Alpine TCP -> host:2577", flush=True)
        last_control = None
        last_stats = 0
        while True:
            time.sleep(.5)
            control_file = CACHE / "netem-control.json"
            if control_file.exists():
                control = json.loads(control_file.read_text(encoding="utf8"))
                if control != last_control:
                    rtt, jitter, loss = (float(control[k]) for k in ("rttMs", "jitterMs", "lossPercent"))
                    if not (0 <= rtt <= 2000 and 0 <= jitter <= 1000 and 0 <= loss <= 10):
                        raise ValueError("Unsafe impairment configuration")
                    console.command(f"tc qdisc replace dev eth0 root netem delay {rtt/2:g}ms {jitter/2:g}ms loss {loss:g}%")
                    last_control = control
                    (CACHE / "netem-applied.json").write_text(json.dumps(control), encoding="utf8")
                    last_stats = 0
            if time.monotonic() - last_stats >= 10:
                stats = console.command("tc -s -j qdisc show dev eth0; grep -A1 '^Tcp:' /proc/net/snmp")
                (CACHE / "netem-stats.txt").write_text(stats, encoding="utf8")
                print("NETEM_STATS " + stats[-1400:].replace("\r", ""), flush=True)
                last_stats = time.monotonic()
    except KeyboardInterrupt:
        pass
    finally:
        if console:
            console.socket.close()
        process.terminate()
        process.wait(timeout=10)
        log.close()


if __name__ == "__main__":
    main()
