// Absolute deadlines compensate timer quantization and callback cost. Late patches
// are skipped, never replayed in a burst; physics has its own bounded accumulator.
export function cadence(hz,callback,{now=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout}={}){
  const period=1000/hz;let next=now()+period,timer,stopped=false;
  const arm=()=>{timer=schedule(wake,Math.max(0,Math.floor(next-now())));};
  const wake=()=>{
    if(stopped)return;
    const time=now();
    if(time+.01<next){arm();return;}
    callback();next+=period;
    const ended=now();if(next<ended-period)next+=Math.ceil((ended-next)/period)*period;
    if(!stopped)arm();
  };
  arm();return ()=>{stopped=true;cancel(timer);};
}
