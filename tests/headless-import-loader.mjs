export async function resolve(specifier,context,nextResolve){
  if(specifier==='three'||specifier.startsWith('three/'))throw Error('Headless core imported Three.js: '+specifier);
  return nextResolve(specifier,context);
}
