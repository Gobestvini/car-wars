import * as THREE from 'three';

export const APPEARANCE_LANDING = .7;
export const APPEARANCE_DURATION = .9;
const ease = t => { t=Math.max(0,Math.min(1,t)); return t*t*(3-2*t); };
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

/** Fixed-capacity cloud slots and shared instanced billboard particles. */
export class VehicleSpawnEffects {
  constructor(scene) {
    this.slots=Array(32).fill(null);this.rejected=0;
    this.geometry=new THREE.PlaneGeometry(1,1);
    this.geometry.setAttribute('cloudOpacity',new THREE.InstancedBufferAttribute(new Float32Array(256),1));
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,toneMapped:false,
      vertexShader:`attribute float cloudOpacity; varying vec2 vUv; varying float vOpacity;
        void main(){vUv=uv;vOpacity=cloudOpacity;
          vec4 center=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
          float scale=length(instanceMatrix[0].xyz);
          center.xy+=position.xy*scale;gl_Position=projectionMatrix*center;}`,
      fragmentShader:`varying vec2 vUv;varying float vOpacity;
        void main(){vec2 p=vUv*2.-1.;float r=length(p);float alpha=(1.-smoothstep(.25,1.,r))*vOpacity;
          if(alpha<.002)discard;
          gl_FragColor=vec4(mix(vec3(1.,.89,.72),vec3(1.,.98,.94),1.-r),alpha);
          #include <colorspace_fragment>
        }`});
    this.mesh=new THREE.InstancedMesh(this.geometry,this.material,256);this.mesh.name='Vehicle appearance clouds';
    this.mesh.frustumCulled=false;this.mesh.count=0;this.mesh.renderOrder=3;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.geometry.attributes.cloudOpacity.setUsage(THREE.DynamicDrawUsage);scene.add(this.mesh);
    this.matrix=new THREE.Matrix4();this.position=new THREE.Vector3();this.scale=new THREE.Vector3();this.rotation=new THREE.Quaternion();
    this.frustum=new THREE.Frustum();this.projection=new THREE.Matrix4();this.sphere=new THREE.Sphere(new THREE.Vector3(),5);
  }
  acquire(owner, timeline, pose, player=false) {
    const start=player?0:1,end=player?1:32;
    for(let i=start;i<end;i++) if(!this.slots[i]) {this.slots[i]={owner,timeline,pose};return i;}
    this.rejected++;return -1;
  }
  release(owner) {for(let i=0;i<this.slots.length;i++) if(this.slots[i]?.owner===owner)this.slots[i]=null;}
  reset() {this.slots.fill(null);this.mesh.count=0;}
  update(camera, quality='high') {
    let count=0;
    if(camera) {camera.updateMatrixWorld();this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.projection);}
    for(let slot=0;slot<32;slot++) {
      const item=this.slots[slot];if(!item)continue;
      const {timeline,pose}=item,t=timeline.elapsed;
      if(timeline.finished) {this.slots[slot]=null;continue;}
      this.sphere.center.set(pose.x,pose.y+2,pose.z);
      if(camera&&!this.frustum.intersectsSphere(this.sphere))continue;
      const particles=quality==='low'?4:8;
      const expand=ease(t/.4),fade=1-ease((t-.55)/.35);
      for(let i=0;i<particles;i++) {
        const angle=i/particles*Math.PI*2+slot*.73;
        const radius=expand*(.3+t*1.8);
        this.position.set(pose.x+Math.cos(angle)*radius,pose.y+3-1.5*ease(t/.65)+Math.sin(i*2.1)*.24,
          pose.z+Math.sin(angle)*radius);
        this.scale.setScalar(.12+expand*(1.1+(i%3)*.22));
        this.matrix.compose(this.position,this.rotation,this.scale);this.mesh.setMatrixAt(count,this.matrix);
        this.geometry.attributes.cloudOpacity.setX(count,.55*fade);count++;
      }
    }
    this.mesh.count=count;this.mesh.visible=count>0;
    if(count){this.mesh.instanceMatrix.needsUpdate=true;this.geometry.attributes.cloudOpacity.needsUpdate=true;}
  }
  snapshot() {return {capacity:32,active:this.slots.filter(Boolean).length,particles:this.mesh.count,rejected:this.rejected};}
  dispose() {this.reset();this.mesh.removeFromParent();this.mesh.dispose();this.geometry.dispose();this.material.dispose();}
}
