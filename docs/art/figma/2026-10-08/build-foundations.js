// Figma Plugin API. Helpers adapted from figma-generate-library scripts.
const page = figma.currentPage;
if (page.children.length) throw new Error('Foundation requires the inspected empty page.');
page.name = 'Car Stars · Экраны и компоненты';
await Promise.all(['Regular','Bold','ExtraBold'].map(style => figma.loadFontAsync({family:'Nunito',style})));
await figma.loadFontAsync({family:'Russo One',style:'Regular'});
function rgb(hex){return {r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255};}
function createVariableCollection(name, modeNames) {
  const collection=figma.variables.createVariableCollection(name), modeIds={};
  collection.renameMode(collection.modes[0].modeId,modeNames[0]);
  modeIds[modeNames[0]]=collection.modes[0].modeId;
  for(let i=1;i<modeNames.length;i++) modeIds[modeNames[i]]=collection.addMode(modeNames[i]);
  return {collection,modeIds};
}
function createSemanticTokens(collection,modeIds,tokenMap){
  const variables={};
  for(const token of tokenMap){
    const v=figma.variables.createVariable(token.name,collection,token.type);
    for(const [mode,value] of Object.entries(token.values))v.setValueForMode(modeIds[mode],value);
    v.scopes=token.scopes||[];v.setVariableCodeSyntax('WEB',`var(--${token.name.replaceAll('/','-')})`);variables[token.name]=v;
  }return variables;
}
const palette={ink:'#102749',cream:'#FFF9EC',gold:'#FFD33D',blue:'#1675F7',coral:'#F66B60',muted:'#586E88',line:'#D9E2EA',white:'#FFFFFF',pale:'#EAF4FF'};
const {collection,modeIds}=createVariableCollection('Car Stars · UI',['Day']);
const vars=createSemanticTokens(collection,modeIds,Object.entries(palette).map(([name,hex])=>({name:'color/'+name,type:'COLOR',values:{Day:{...rgb(hex),a:1}},scopes:['FRAME_FILL','SHAPE_FILL','TEXT_FILL','STROKE_COLOR']})).concat([8,12,16,24].map(n=>({name:'space/'+n,type:'FLOAT',values:{Day:n},scopes:['GAP']})),[16,24].map(n=>({name:'radius/'+n,type:'FLOAT',values:{Day:n},scopes:['CORNER_RADIUS']}))));
function paint(key){return figma.variables.setBoundVariableForPaint({type:'SOLID',color:rgb(palette[key])},'color',vars['color/'+key]);}
const styles={};
for(const [name,family,style,size] of [['Display','Russo One','Regular',42],['Heading','Russo One','Regular',26],['Button','Russo One','Regular',22],['Body','Nunito','Bold',16],['Caption','Nunito','ExtraBold',12],['Value','Russo One','Regular',24]]){
 const s=figma.createTextStyle();s.name='Car Stars/'+name;s.fontName={family,style};s.fontSize=size;s.lineHeight={unit:'PERCENT',value:120};styles[name]=s.id;
}
const shadow=figma.createEffectStyle();shadow.name='Car Stars/Card elevation';shadow.effects=[{type:'DROP_SHADOW',color:{...rgb(palette.ink),a:.16},offset:{x:0,y:6},radius:16,spread:0,visible:true,blendMode:'NORMAL'}];
function txt(parent,value,style,key='ink'){const t=figma.createText();t.fontName=style==='Body'?{family:'Nunito',style:'Bold'}:style==='Caption'?{family:'Nunito',style:'ExtraBold'}:{family:'Russo One',style:'Regular'};t.characters=value;t.textStyleId=styles[style];t.fills=[paint(key)];t.textAutoResize='WIDTH_AND_HEIGHT';parent.appendChild(t);return t;}
// Adapted Cartesian-product/variant-grid helper.
function createComponentWithVariants(name,axis,values,width,height,build){
 const comps=values.map(value=>{const c=figma.createComponent();c.name=axis+'='+value;c.resize(width,height);page.appendChild(c);build(c,value);return c;});
 const set=figma.combineAsVariants(comps,page);set.name=name;set.description='Car Stars: reusable editable UI. Colors use local variables.';
 comps.forEach((c,i)=>{c.x=24;c.y=24+i*(height+20);});set.resize(width+48,values.length*(height+20)+28);return {set,comps};
}
const buttons=createComponentWithVariants('Button','Tone',['Gold','Blue','Secondary'],342,64,(c,value)=>{
 c.layoutMode='HORIZONTAL';c.primaryAxisAlignItems='CENTER';c.counterAxisAlignItems='CENTER';c.primaryAxisSizingMode='FIXED';c.counterAxisSizingMode='FIXED';c.itemSpacing=12;c.setBoundVariable('cornerRadius',vars['radius/16']);c.fills=[paint(value==='Gold'?'gold':value==='Blue'?'blue':'cream')];c.strokes=[paint(value==='Blue'?'blue':value==='Gold'?'gold':'ink')];c.strokeWeight=value==='Secondary'?1.5:1;c.effects=[{type:'DROP_SHADOW',color:{...rgb(palette.ink),a:.24},offset:{x:0,y:5},radius:0,spread:0,visible:true,blendMode:'NORMAL'}];
 const t=txt(c,'PLAY','Button',value==='Blue'?'white':'ink');t.name='Label';const key=c.addComponentProperty('Label','TEXT','PLAY');t.componentPropertyReferences={characters:key};
});buttons.set.x=1560;buttons.set.y=250;
const paths={star:'M12 1.8 15.1 8.2 22.2 9.2 17.1 14.2 18.3 21.3 12 18 5.7 21.3 6.9 14.2 1.8 9.2 8.9 8.2Z',play:'M8 4 21 12 8 20Z',pause:'M7 5V19M17 5V19',check:'M5 12 10 17 20 7',shield:'M12 2 21 6V12C21 17 16 21 12 23C8 21 3 17 3 12V6Z',target:'M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2M12 8A4 4 0 1 0 12 16A4 4 0 1 0 12 8',gear:'M12 2V5M12 19V22M2 12H5M19 12H22M5 5 7 7M17 17 19 19M5 19 7 17M17 7 19 5M12 7A5 5 0 1 0 12 17A5 5 0 1 0 12 7',brake:'M5 20 9 14 5 8M14 20 18 14 14 8M12 2A5 5 0 1 0 12 12A5 5 0 1 0 12 2',clock:'M12 3A9 9 0 1 0 12 21A9 9 0 1 0 12 3M12 7V12L16 14'};
const icons={};let ix=0;
for(const [name,path] of Object.entries(paths)){
 const c=figma.createComponent();c.name='Icon/'+name;c.description='Editable SVG icon.';c.resize(24,24);c.fills=[];
 const svg=figma.createNodeFromSvg(`<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="${path}" fill="${name==='star'||name==='play'?palette.ink:'none'}" stroke="${palette.ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`);c.appendChild(svg);svg.x=0;svg.y=0;
 c.x=1584+(ix%6)*56;c.y=670+Math.floor(ix/6)*56;page.appendChild(c);icons[name]=c.id;ix++;
}
const stars=createComponentWithVariants('Star','State',['Earned','Empty'],40,40,(c,state)=>{
 c.fills=[];const svg=figma.createNodeFromSvg(`<svg width="40" height="40" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="${paths.star}" fill="${state==='Earned'?palette.gold:palette.line}" stroke="${state==='Earned'?'#E4A41C':'#A1B2C7'}" stroke-width="1.1" stroke-linejoin="round"/></svg>`);c.appendChild(svg);svg.x=0;svg.y=0;
});stars.set.x=1990;stars.set.y=250;
const hud=createComponentWithVariants('HUD/Metric','Tone',['Light','Dark'],116,74,(c,tone)=>{
 c.layoutMode='VERTICAL';c.primaryAxisAlignItems='CENTER';c.counterAxisAlignItems='CENTER';c.itemSpacing=4;c.setBoundVariable('cornerRadius',vars['radius/16']);c.fills=[paint(tone==='Light'?'cream':'ink')];c.effectStyleId=shadow.id;
 const label=txt(c,'СКОРОСТЬ','Caption',tone==='Light'?'muted':'pale'),value=txt(c,'112','Value',tone==='Light'?'ink':'white');label.name='Label';value.name='Value';label.componentPropertyReferences={characters:c.addComponentProperty('Label','TEXT','СКОРОСТЬ')};value.componentPropertyReferences={characters:c.addComponentProperty('Value','TEXT','112')};
});hud.set.x=2160;hud.set.y=250;
const tag=figma.createAutoLayout('VERTICAL',{name:'Library heading',itemSpacing:8});tag.fills=[];tag.x=1560;tag.y=100;txt(tag,'CAR STARS','Display');txt(tag,'КОМПОНЕНТЫ · ЦВЕТА · ТИПОГРАФИКА','Caption','muted');
const created=page.findAll(()=>true).map(n=>n.id);
return {createdNodeIds:created,mutatedNodeIds:[page.id],pageId:page.id,buttons:{set:buttons.set.id,variants:buttons.comps.map(c=>({id:c.id,name:c.name,properties:c.findAllWithCriteria({types:['TEXT']}).map(t=>t.componentPropertyReferences)}))},stars:stars.comps.map(c=>({id:c.id,name:c.name})),metrics:hud.comps.map(c=>({id:c.id,name:c.name,properties:c.findAllWithCriteria({types:['TEXT']}).map(t=>t.componentPropertyReferences)})),icons,styles,shadow:shadow.id,variables:Object.fromEntries(Object.entries(vars).map(([k,v])=>[k,v.id])),collectionId:collection.id,nodeCount:created.length};
