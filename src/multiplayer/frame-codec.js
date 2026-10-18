// Full independent motion frames over the reliable room socket. Schema remains
// the actor lifecycle channel; per-element Schema mutation is avoided at 20 Hz.
const encoder=new TextEncoder(),decoder=new TextDecoder();
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function encodeFrame(snapshot){
  const actors=[...snapshot.players,...snapshot.actors],bytes=new Uint8Array(7+actors.length*192),view=new DataView(bytes.buffer);let offset=0;
  const u8=v=>view.setUint8(offset++,v),u16=v=>{view.setUint16(offset,v,true);offset+=2;},
    i16=v=>{view.setInt16(offset,clamp(Math.round(v),-32767,32767),true);offset+=2;},
    u32=v=>{view.setUint32(offset,v,true);offset+=4;},i32=v=>{view.setInt32(offset,v,true);offset+=4;},
    f32=v=>{if(!Number.isFinite(v))throw Error('Non-finite authoritative pose');view.setFloat32(offset,v,true);offset+=4;};
  u8(1);u32(snapshot.tick);u16(actors.length);
  for(const actor of actors){
    const id=encoder.encode(actor.id);if(!id.length || id.length>64)throw Error('Invalid actor ID');
    if(![...actor.p,...actor.q,...actor.v,actor.steering,actor.damage].every(Number.isFinite))throw Error('Invalid authoritative motion');
    u8(id.length);bytes.set(id,offset);offset+=id.length;
    const player=actor.role==='player';u8(Number(player)|Number(actor.connected)<<1|Number(actor.physical)<<2);
    u32(actor.generation);i32(actor.lastProcessedInputSeq);actor.p.forEach(f32);actor.q.forEach(v=>i16(v*32767));
    actor.v.forEach(v=>i16(v*100));i16(actor.steering*1000);u16(Math.round(clamp(actor.damage,0,1)*65535));
    if(player)for(const wheel of actor.wheels){
      wheel.p.forEach(f32);f32(wheel.rotation);u16(Math.round(clamp(wheel.slip,0,20)*1000));
      u8(Number(wheel.grounded)|Number(wheel.detached)<<1);
    }
  }
  return bytes.subarray(0,offset);
}
export function decodeFrame(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<7)throw Error('Truncated motion frame');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=0;
  const u8=()=>view.getUint8(offset++),u16=()=>{const v=view.getUint16(offset,true);offset+=2;return v;},
    i16=()=>{const v=view.getInt16(offset,true);offset+=2;return v;},u32=()=>{const v=view.getUint32(offset,true);offset+=4;return v;},
    i32=()=>{const v=view.getInt32(offset,true);offset+=4;return v;},f32=()=>{const v=view.getFloat32(offset,true);offset+=4;return v;};
  if(u8()!==1)throw Error('Unsupported motion frame');
  const tick=u32(),count=u16(),actors=new Map();if(count>512)throw Error('Too many frame actors');
  for(let index=0;index<count;index++){
    const length=u8();if(!length||length>64||offset+length>bytes.length)throw Error('Invalid frame actor ID');
    const id=decoder.decode(bytes.subarray(offset,offset+length));offset+=length;
    const flags=u8(),generation=u32(),ack=i32(),pose=[f32(),f32(),f32(),i16()/32767,i16()/32767,i16()/32767,i16()/32767,
      i16()/100,i16()/100,i16()/100,0,0,0],steering=i16()/1000,damage=u16()/65535,wheels=[];
    const qLength=Math.hypot(...pose.slice(3,7));if(qLength<.5 || qLength>1.5)throw Error('Invalid motion quaternion');
    for(let i=3;i<7;i++)pose[i]/=qLength;
    if(flags&1)for(let w=0;w<4;w++){
      const x=f32(),y=f32(),z=f32(),rotation=f32(),slip=u16()/1000,wf=u8();
      wheels.push(x,y,z,rotation,slip,Number(Boolean(wf&1)),Number(Boolean(wf&2)));
    }
    if(![...pose,...wheels,steering,damage].every(Number.isFinite)||actors.has(id))throw Error('Invalid motion frame');
    actors.set(id,{id,role:flags&1?'player':'civilian',connected:Boolean(flags&2),physical:Boolean(flags&4),generation,ack,pose,wheels,steering,damage});
  }
  if(offset!==bytes.byteLength)throw Error('Trailing motion data');
  return {tick,actors};
}
