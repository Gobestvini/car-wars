import { randomInt,randomUUID } from 'node:crypto';
import { schema,t } from '@colyseus/schema';
import { DrivingSpikeRoom } from './server.js';
import { validateCommands,validateInput } from './protocol.js';
import { createGameWorld } from '../../src/simulation/game-world.js';
import { encodeFrame } from '../../src/multiplayer/frame-codec.js';
import { JOIN_OPTIONS,ROOM_LIMITS,validMapReady } from '../../src/multiplayer/protocol.js';
import { cadence } from './room-clock.js';

const HostedState=schema({tick:t.uint32(),seed:t.uint32(),signature:t.string(),contactCount:t.uint32(),roundId:t.string()});
const trim=(values,max=1000)=>{if(values.length>max)values.splice(0,values.length-max);};

// Admission belongs to one server instance; public matchmaking options never configure physics.
export function hostedRoomType(admission,{mapReadyMs=ROOM_LIMITS.mapReadyMs,reconnectSeconds=15}={}){
  return class HostedDrivingRoom extends DrivingSpikeRoom{
    createWorld(options){return createGameWorld(options);}
    async onCreate(){
      if(admission.rooms.size>=admission.maxRooms)throw Error('Сервер занят: нет свободных комнат. Попробуйте позже.');
      admission.rooms.add(this);this.loaderMs=mapReadyMs;this.pendingMaps=new Map();this.transfers=new Map();
      this.rejectReconnect=new Set();this.rpcTimes=new Map();this.lastRespawn=new Map();this.transferSerial=0;
      this.roundId=randomUUID();this.maxMessagesPerSecond=Infinity; // The raw gate below counts every packet, including unknown types.
      try{
        const fixed=process.env.CARWARS_FIXED_SEED,seed=fixed===undefined?randomInt(0,4294967296):Number(fixed);
        if(!Number.isSafeInteger(seed)||seed<0||seed>=4294967296)throw Error('Invalid configured map seed');
        super.onCreate({npcCount:102,reconnectSeconds,seed,registerMessages:false});
        // The base room starts timers synchronously. Stop them before yielding:
        // hosted state/metrics and the verified map do not exist until ready.
        this.patchRate=null;this.setSimulationInterval();this._simulationInterval=undefined;
        await this.sim.ready;
        this.state=new HostedState({tick:0,seed,signature:this.sim.signature,contactCount:0,roundId:this.roundId});
        Object.assign(this.metrics,{slowDrops:0,malformed:0,faults:0,loadingTimeouts:0,queueBytes:0,maxQueueBytes:0,
          schedulerIntervals:[],patchIntervals:[],bodyCount:0,clients:0,loading:0,reserved:0});
        this.onMessage('input',(c,p)=>{if(!this.allowed(c,p,true))return;const {generation,...fields}=p??{},actor=this.sim.players.get(c.sessionId);
          const input=generation===actor.generation?validateInput(fields,this.roundId):null;
          if(!input){this.metrics.invalidInputs++;return;}if(!this.sim.input(c.sessionId,input))this.metrics.invalidInputs++;else if(input.seq>=2147483000)c.send('epoch-required');});
        this.onMessage('input-epoch',(c,p)=>{const actor=this.sim.players.get(c.sessionId);
          if(this.allowed(c,p)&&p?.roundId===this.roundId&&p.generation===actor.generation&&actor.receivedSeq>=2147483000){this.sim.rotateInputEpoch(actor.id);c.send('epoch',{generation:actor.generation});}});
        this.onMessage('commands',(c,p)=>{if(!this.allowed(c,p,true))return;const packet=validateCommands(p,this.roundId);
          if(!packet||!this.sim.timedInput(c.sessionId,packet))this.metrics.invalidInputs++;});
        this.onMessage('hello',c=>{if(this.rpc(c,'hello',1000))this.transfer(c,'welcome',this.welcome(c));});
        this.onMessage('full',c=>{if(this.rpc(c,'full',1000))this.transfer(c,'full',this.snapshot());});
        this.onMessage('map-ready',(c,p)=>{
          const pending=this.pendingMaps.get(c.sessionId);if(!pending||!this.payload(p))return;
          const expected={nonce:pending.nonce,roundId:this.roundId,signature:this.sim.signature,buildId:JOIN_OPTIONS.buildId,mapVersion:JOIN_OPTIONS.mapVersion};
          if(!validMapReady(p,expected)){this.metrics.invalidInputs++;this.eject(c,4003);return;}
          pending.timer.clear();this.pendingMaps.delete(c.sessionId);
          const actor=this.sim.players.get(c.sessionId);if(actor){actor.connected=true;this.sim.halt(actor.id);}else this.sim.addPlayer(c.sessionId);
          c.send('ready',{roundId:this.roundId,playerId:c.sessionId});c.sendBytes('frame',encodeFrame(this.snapshot()));
          c.send('gameplay',this.gameplay());
        });
        this.onMessage('ping',(c,p)=>{if(!Number.isFinite(p)||!this.rpc(c,'ping',400))return;c.send('pong',{stamp:p,tick:this.sim.tick});});
        this.onMessage('halt',(c,p)=>{if(this.allowed(c,p)&&this.sim.players.get(c.sessionId)?.generation===p)this.sim.halt(c.sessionId);});
        this.onMessage('respawn',(c,p)=>{if(!this.allowed(c,p))return;const actor=this.sim.players.get(c.sessionId),last=this.lastRespawn.get(c.sessionId);
          if(actor.sim.appearing||p?.roundId!==this.roundId||p.generation!==actor.generation||!Number.isSafeInteger(p.requestId)||p.requestId<1||p.requestId>2147483647||p.requestId<=(last?.requestId??0)||performance.now()-(last?.at??-Infinity)<3000)return;
          if(!this.rpc(c,'respawn',3000))return;
          if(this.sim.respawn(c.sessionId)){this.lastRespawn.set(c.sessionId,{requestId:p.requestId,at:performance.now()});c.send('respawned',{requestId:p.requestId,generation:actor.generation});}});
        this.onMessage('*',c=>{this.metrics.invalidInputs++;if((c.badMessages=(c.badMessages??0)+1)>40)this.eject(c,4008);});
        // Cold map preparation must not consume newly admitted loader timers.
        this.clock.start();this.lastTime=performance.now();this.accumulator=0;
        this.stopScheduler=cadence(60,()=>{this.clock.tick();this.advance();});
        this.stopPatches=cadence(20,()=>this.broadcastPatch());
      }catch(e){admission.rooms.delete(this);this.sim?.dispose();throw e;}
    }
    onAuth(client,options){
      if(this.shuttingDown||Object.entries(JOIN_OPTIONS).some(([k,v])=>options?.[k]!==v))throw Error('Game protocol/build/map version outdated; reload the page');
      return true;
    }
    snapshot(){const state=this.sim.snapshot();return {...state,...JOIN_OPTIONS,roundId:this.roundId,buildId:JOIN_OPTIONS.buildId,
      generatorVersion:JOIN_OPTIONS.generatorVersion,events:state.events.map(e=>({...e,id:`${this.roundId}:${e.id}`}))};}
    gameplay(){return {...this.sim.gameplaySnapshot(),roundId:this.roundId,events:this.sim.events.map(e=>({...e,id:`${this.roundId}:${e.id}`}))};}
    welcome(c){return {...JOIN_OPTIONS,playerId:c.sessionId,roomId:this.roomId,roundId:this.roundId,
      nonce:this.pendingMaps.get(c.sessionId)?.nonce??null,snapshot:this.snapshot(),map:this.sim.map};}
    beginLoad(c){
      this.pendingMaps.get(c.sessionId)?.timer.clear();
      const nonce=randomUUID(),timer=this.clock.setTimeout(()=>{this.metrics.loadingTimeouts++;this.eject(c,4004);},this.loaderMs);
      this.pendingMaps.set(c.sessionId,{nonce,timer});
    }
    onJoin(c){this.meter(c);this.beginLoad(c);}
    onReconnect(c){this.meter(c);this.beginLoad(c);}
    clearClient(id){this.pendingMaps.get(id)?.timer.clear();this.pendingMaps.delete(id);this.transfers.delete(id);
      this.rpcTimes.delete(id);this.buckets.delete(id);this.metrics.byClient.delete(id);}
    onLeave(c){this.clearClient(c.sessionId);this.lastRespawn.delete(c.sessionId);this.rejectReconnect.delete(c.sessionId);this.sim.removePlayer(c.sessionId);}
    async onDrop(c,code){
      this.clearClient(c.sessionId);this.sim.disconnect(c.sessionId);
      if(this.shuttingDown||[1009,4002,4003,4004,4008].includes(code)||this.rejectReconnect.has(c.sessionId)||!this.sim.players.has(c.sessionId)){this.onLeave(c);return;}
      try{await this.allowReconnection(c,this.reconnectSeconds);}catch{this.onLeave(c);}
    }
    eject(c,code){this.rejectReconnect.add(c.sessionId);this.sim.halt(c.sessionId);c.leave(code);}
    payload(p){try{return p===undefined||Buffer.byteLength(JSON.stringify(p))<=ROOM_LIMITS.inputBytes;}catch{return false;}}
    allowed(c,p,input=false){
      if(!this.payload(p)){this.metrics.invalidInputs++;return false;}
      if(this.shuttingDown||this.pendingMaps.has(c.sessionId)||!this.sim.players.get(c.sessionId)?.connected)return false;
      if(input){const now=performance.now();let b=this.buckets.get(c.sessionId);
        if(!b||now-b.start>=1000){b={start:now,count:0};this.buckets.set(c.sessionId,b);}
        if(++b.count>ROOM_LIMITS.inputPerSecond){this.metrics.rateLimited++;if(b.count>80)this.eject(c,4008);return false;}}
      return true;
    }
    rpc(c,type,interval){const now=performance.now();let times=this.rpcTimes.get(c.sessionId);
      if(!times){times=new Map();this.rpcTimes.set(c.sessionId,times);}
      if(now-(times.get(type)??-Infinity)<interval){this.metrics.rateLimited++;return false;}times.set(type,now);return true;}
    _onMessage(c,buffer){
      const now=performance.now();if(!c.inbound||now-c.inbound.start>=1000)c.inbound={start:now,count:0};
      if(++c.inbound.count>ROOM_LIMITS.messagesPerSecond){this.metrics.rateLimited++;this.eject(c,4008);return;}
      try{super._onMessage(c,buffer);}catch{this.metrics.malformed++;this.eject(c,4002);}
    }
    meter(c){
      const raw=c.ref;if(raw.__spikeMeter)return;raw.__spikeMeter=true;const send=raw.send.bind(raw);
      raw.on('error',error=>{if(String(error.code).startsWith('WS_ERR_'))this.rejectReconnect.add(c.sessionId);});
      raw.send=(data,...args)=>{
        const bytes=typeof data==='string'?Buffer.byteLength(data):data.byteLength,queued=raw.bufferedAmount??0;
        this.metrics.maxQueueBytes=Math.max(this.metrics.maxQueueBytes,queued);
        if(queued+bytes+10>ROOM_LIMITS.socketBytes){this.metrics.slowDrops++;raw.terminate();return;}
        if(raw.readyState!==1)return;
        const wire=bytes+(bytes<126?2:bytes<=65535?4:10);this.metrics.wireBytes+=wire;this.metrics.payloadBytes+=bytes;this.metrics.frames++;
        this.metrics.byClient.set(c.sessionId,(this.metrics.byClient.get(c.sessionId)??0)+wire);
        try{return send(data,...args);}catch{raw.terminate();}
      };
    }
    transfer(c,kind,dto){
      if(this.transfers.has(c.sessionId))return;
      const bytes=new TextEncoder().encode(JSON.stringify(dto));if(bytes.length>ROOM_LIMITS.transferBytes){this.eject(c,4009);return;}
      const transfer={id:++this.transferSerial,bytes,offset:0,index:0,at:performance.now()};this.transfers.set(c.sessionId,transfer);
      c.send('transfer-start',{id:transfer.id,kind,bytes:bytes.length});this.flushTransfer(c);
    }
    flushTransfer(c){
      const a=this.transfers.get(c.sessionId);if(!a)return;
      if(performance.now()-a.at>10000){this.eject(c,4004);return;}
      for(let i=0;i<2&&a.offset<a.bytes.length;i++){
        const size=Math.min(ROOM_LIMITS.chunkBytes,a.bytes.length-a.offset),bytes=new Uint8Array(size+8),view=new DataView(bytes.buffer);
        view.setUint32(0,a.id);view.setUint32(4,a.index++);bytes.set(a.bytes.subarray(a.offset,a.offset+size),8);a.offset+=size;
        c.sendBytes('transfer-chunk',bytes);
      }
      if(a.offset===a.bytes.length)this.transfers.delete(c.sessionId);
    }
    fault(error){this.lastFault=String(error?.stack??error).slice(0,1500);if(this.shuttingDown)return;this.metrics.faults++;this.shuttingDown=true;void this.disconnect(4010);}
    advance(){
      const now=performance.now();if(this.lastSchedulerAt!==undefined)this.metrics.schedulerIntervals.push(now-this.lastSchedulerAt);this.lastSchedulerAt=now;
      try{super.advance();}catch(error){this.fault(error);}
      trim(this.metrics.schedulerIntervals);trim(this.metrics.schedulerMs);trim(this.sim.metrics.stepMs);trim(this.sim.metrics.aiMs);trim(this.sim.metrics.physicalCounts);
    }
    onBeforePatch(){
      try{
        const now=performance.now();if(this.lastPatchAt!==undefined)this.metrics.patchIntervals.push(now-this.lastPatchAt);this.lastPatchAt=now;trim(this.metrics.patchIntervals);
        this.state.tick=this.sim.tick;this.state.contactCount=this.sim.contacts;
        this.metrics.clients=this.clients.length;this.metrics.loading=this.pendingMaps.size;
        this.metrics.reserved=[...this.sim.players.values()].filter(a=>!a.connected).length;this.metrics.bodyCount=this.sim.world.bodies.length;
        this.metrics.queueBytes=this.clients.reduce((n,c)=>n+(c.ref.bufferedAmount??0),0);
        const snapshot=this.snapshot(),frame=encodeFrame(snapshot),gameplay=this.gameplay();
        const changed=this.sentGameplayRevision!==this.sim.gameplayRevision||this.sentEvent!==this.sim.eventSerial;
        for(const c of this.clients){this.flushTransfer(c);if(this.pendingMaps.has(c.sessionId))continue;
          c.sendBytes('frame',frame);if(changed)c.send('gameplay',gameplay);}
        this.sentGameplayRevision=this.sim.gameplayRevision;this.sentEvent=this.sim.eventSerial;
        this.metrics.snapshotMs.push(performance.now()-now);trim(this.metrics.snapshotMs);
      }catch(error){this.fault(error);}
    }
    broadcastPatch(){const result=super.broadcastPatch();trim(this.metrics.encodingMs);return result;}
    onBeforeShutdown(){this.shuttingDown=true;for(const c of this.clients)c.send('shutdown',{reason:'server-shutdown',roomLost:true});return this.disconnect(1001);}
    onDispose(){
      this.stopScheduler?.();this.stopPatches?.();this.stopScheduler=this.stopPatches=null;
      admission.rooms.delete(this);for(const p of this.pendingMaps?.values()??[])p.timer.clear();
      this.pendingMaps?.clear();this.transfers?.clear();this.rejectReconnect?.clear();this.rpcTimes?.clear();this.lastRespawn?.clear();
      if(this.sim)super.onDispose();this.metrics?.byClient.clear();
      if(this.metrics)Object.assign(this.metrics,{clients:0,loading:0,reserved:0,bodyCount:0,queueBytes:0});
    }
  };
}
