import { PROP_LIFETIME, PROP_FADE_SECONDS } from '../street-prop-config.js';

export class StreetVisuals {
  constructor(){this.entries=new Map();this.previousChanged=new Set();}
  register(source){this.entries.set(source.id,{...source,state:'intact'});}
  sync(physics){
    const changed=new Set([...physics.changedEntries,...this.previousChanged]);
    for(const e of changed){
      const v=this.entries.get(e.id);if(!v)continue;
      if(v.state!==e.state){
        if(e.state==='intact')v.restore?.();
        else if(v.state==='intact')v.onDetach?.();
        if(e.state==='removed')v.hide?.();
        v.state=e.state;
      }
      if(e.state==='detached')v.sync?.(e.body,Math.max(0,Math.min(1,(PROP_LIFETIME-physics.clock+e.destroyedAt)/PROP_FADE_SECONDS)));
    }
    this.previousChanged=new Set(physics.changedEntries);
  }
  dispose(){this.entries.clear();this.previousChanged.clear();}
}
