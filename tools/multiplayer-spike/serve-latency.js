import { startServer } from './server.js';
import { startProxy } from './tcp-proxy.js';
const server=await startServer({port:2578,browser:true});
const proxy=await startProxy({targetPort:server.port,port:2580,rttMs:100,jitterMs:20});
console.log('Browser RTT100/jitter20: http://127.0.0.1:2578/?endpoint=http://127.0.0.1:2580');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await proxy.close();await server.close();process.exit(0);});
