// Delay the actual HTTP/WebSocket TCP byte stream in FIFO order, not SDK messages.
// This models latency/jitter only. It does NOT model TCP packet loss/retransmission.
import net from 'node:net';
import { performance } from 'node:perf_hooks';
export async function startProxy({ targetPort, rttMs = 0, jitterMs = 0, seed = 42, port = 0 }) {
  let randomState = seed >>> 0;
  const random = () => { randomState = (Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/2**32; };
  const sockets = new Set(); const timers = new Set();
  const metrics = { forwardedBytes:0, maxQueuedBytes:0, closedBackpressure:0, connections:0 };
  const server = net.createServer(downstream => {
    const upstream = net.connect({host:'127.0.0.1',port:targetPort});
    sockets.add(downstream);sockets.add(upstream);metrics.connections++;
    downstream.setNoDelay(true);upstream.setNoDelay(true);
    for(const [from,to] of [[downstream,upstream],[upstream,downstream]]) {
      let due=0,queuedBytes=0;
      from.on('data',chunk=>{
        const delay=Math.max(0,rttMs/2 + (random()*2-1)*jitterMs/2);
        due=Math.max(due,performance.now()+delay); queuedBytes+=chunk.length;
        metrics.maxQueuedBytes=Math.max(metrics.maxQueuedBytes,queuedBytes);
        if(queuedBytes>4*1024*1024){metrics.closedBackpressure++;from.destroy();to.destroy();return;}
        const timer=setTimeout(()=>{
          timers.delete(timer);queuedBytes-=chunk.length;
          if(!to.destroyed) {metrics.forwardedBytes+=chunk.length;if(!to.write(chunk))from.pause();}
        },Math.max(0,due-performance.now()));timers.add(timer);
      });
      to.on('drain',()=>from.resume());
      from.on('error',()=>{from.destroy();to.destroy();});
      from.on('close',()=>{sockets.delete(from);to.destroy();});
    }
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {port:server.address().port,metrics,close:async()=>{
    for(const t of timers)clearTimeout(t);timers.clear();for(const s of sockets)s.destroy();
    await new Promise(resolve=>server.close(resolve));
  }};
}
