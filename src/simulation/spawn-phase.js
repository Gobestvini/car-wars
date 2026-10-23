export const APPEARANCE_LANDING = .7;
export const APPEARANCE_DURATION = .9;
export const ease = t => { t=Math.max(0,Math.min(1,t)); return t*t*(3-2*t); };
export class VehicleAppearance {
  constructor() { this.elapsed=0; this.stage='appearing'; this.scale=.001; this.offset=3; }
  advance(dt, safe=true) {
    if(this.stage==='cancelled'||this.elapsed>=APPEARANCE_DURATION) return false;
    const next=this.elapsed+Math.max(0,Number.isFinite(dt)?dt:0);
    this.elapsed=this.stage==='appearing'&&!safe ? Math.min(next,APPEARANCE_LANDING) : Math.min(next,APPEARANCE_DURATION);
    const landed=this.stage==='appearing'&&this.elapsed>=APPEARANCE_LANDING&&safe;
    if(landed) this.stage='active';
    this.scale=Math.max(.001,ease((this.elapsed-.15)/.3));
    this.offset=this.elapsed<.15?3-1.2*ease(this.elapsed/.15):1.8*(1-ease((this.elapsed-.35)/.35));
    if(this.stage==='active') {this.scale=1;this.offset=0;}
    return landed;
  }
  cancel() {this.stage='cancelled';this.elapsed=APPEARANCE_DURATION;this.scale=1;this.offset=0;}
  get finished() {return this.elapsed>=APPEARANCE_DURATION;}
  apply(visual) {visual.scale.setScalar(this.scale);visual.position.y=this.offset;}
}
