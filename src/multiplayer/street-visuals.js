import { propOpacity } from '../street-prop-config.js';

export class StreetVisuals {
  constructor(){this.entries=new Map();this.previousChanged=new Set();}
  register(source){this.entries.set(source.id,{...source,state:'intact'});}
  sync(physics){
    const current=new Set([...physics.changedEntries].map(e=>e.index));
    const changed=new Set([...current,...this.previousChanged]);
    for(const index of changed){
      const e=physics.entries[index];if(!e)continue;
      const v=this.entries.get(e.id);if(!v)continue;
      if(v.state!==e.state){
        if(e.state==='intact')v.restore?.();
        else if(v.state==='intact')v.onDetach?.();
        if(e.state==='removed')v.hide?.();
        v.state=e.state;
      }
      if(e.state==='detached')v.sync?.(e.body,propOpacity(physics.clock-e.destroyedAt));
    }
    this.previousChanged=current;
  }
  dispose(){this.entries.clear();this.previousChanged.clear();}
}
