import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=file=>pathToFileURL(path.resolve(file)).href;
const {service,sleep,until}=await import(root('tests/helpers/hosted-room.mjs'));
const {hostedRoomType}=await import(root('tools/multiplayer-spike/hosted-room.js'));
const {RoomClient}=await import(root('src/multiplayer/room-client.js'));
const server=await service();
const report={mapReadyMs:1800,forcedMapReadyDelayMs:3000,presentationDelayMs:500,events:[]};
const Slow=hostedRoomType({rooms:server.rooms,maxRooms:4},{mapReadyMs:report.mapReadyMs});
const createWorld=Slow.prototype.createWorld,onCreate=Slow.prototype.onCreate,beginLoad=Slow.prototype.beginLoad,eject=Slow.prototype.eject;
let room;
Slow.prototype.createWorld=function(options){const world=createWorld.call(this,options);world.ready=Promise.all([world.ready,sleep(report.forcedMapReadyDelayMs)]);return world;};
Slow.prototype.onCreate=async function(...args){const start=performance.now();await onCreate.apply(this,args);room=this;report.createMs=performance.now()-start;report.clockAgeAfterCreateMs=this.clock.now()-this.clock.currentTime;};
Slow.prototype.beginLoad=function(client){report.loadAt=performance.now();report.clockAgeAtLoadMs=this.clock.now()-this.clock.currentTime;report.events.push({event:'beginLoad',at:report.loadAt,clockAge:report.clockAgeAtLoadMs});return beginLoad.call(this,client);};
Slow.prototype.eject=function(client,code){report.events.push({event:'eject',code,at:performance.now(),sinceLoadMs:performance.now()-report.loadAt});return eject.call(this,client,code);};
server.server.define('clock-delayed',Slow);
const client=new RoomClient({sdk:{create:(_,options)=>server.sdk.create('clock-delayed',options)},onWelcome:async()=>{report.events.push({event:'onWelcome',at:performance.now()});await sleep(report.presentationDelayMs);}});
try{
 try{await client.connect();report.connected=true;}catch(error){report.connected=false;report.error=String(error);}
 await sleep(100);
 report.phase=client.phase;report.loadingTimeouts=room?.metrics.loadingTimeouts;
 report.defect=report.events.some(e=>e.event==='eject'&&e.code===4004&&e.sinceLoadMs<report.mapReadyMs-100);
 console.log(report);
}finally{
 fs.writeFileSync('docs/knowledge/multiplayer/2026-10-24-client/qa-clock/startup-clock.json',JSON.stringify(report,null,2));
 await client.leave();await server.cleanup();
}
