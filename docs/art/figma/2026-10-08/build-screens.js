// Input is the returned foundation ledger, injected by the caller as F.
await Promise.all(['Regular','Bold','ExtraBold'].map(style=>figma.loadFontAsync({family:'Nunito',style})));
await figma.loadFontAsync({family:'Russo One',style:'Regular'});
const page=figma.currentPage;
if(page.children.some(n=>n.name==='Car Stars · Six screens'))throw new Error('Screens already exist: inspect before retry.');
const palette={ink:'#102749',cream:'#FFF9EC',gold:'#FFD33D',blue:'#1675F7',coral:'#F66B60',muted:'#586E88',line:'#D9E2EA',white:'#FFFFFF',pale:'#EAF4FF'};
const rgb=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const vars={};for(const [k,id] of Object.entries(F.variables))vars[k]=await figma.variables.getVariableByIdAsync(id);
const comps={};for(const id of [...F.buttons.variants.map(x=>x.id),...F.stars.map(x=>x.id),...F.metrics.map(x=>x.id),...Object.values(F.icons)])comps[id]=await figma.getNodeByIdAsync(id);
function paint(k,opacity=1){const p=figma.variables.setBoundVariableForPaint({type:'SOLID',color:rgb(palette[k]),opacity},'color',vars['color/'+k]);return p;}
function tx(parent,value,style='Body',key='ink',size,width){
 const t=figma.createText();t.fontName=style==='Body'?{family:'Nunito',style:'Bold'}:style==='Caption'?{family:'Nunito',style:'ExtraBold'}:{family:'Russo One',style:'Regular'};t.characters=value;t.textStyleId=F.styles[style];if(size)t.fontSize=size;t.fills=[paint(key)];t.textAutoResize='WIDTH_AND_HEIGHT';parent.appendChild(t);
 if(width){t.textAutoResize='HEIGHT';t.resize(width,t.height);}t.name=value;return t;
}
function place(n,x,y){n.x=x;n.y=y;return n;}
function rect(p,name,x,y,w,h,key,radius=0,opacity=1){const n=figma.createRectangle();n.name=name;n.resize(w,h);n.fills=[paint(key)];n.opacity=opacity;n.cornerRadius=radius;p.appendChild(n);return place(n,x,y);}
function stack(p,name,x,y,w,direction='VERTICAL',gap=8,key){const n=figma.createAutoLayout(direction,{name,itemSpacing:gap});n.fills=key?[paint(key)]:[];n.resize(w,10);n.primaryAxisSizingMode=direction==='VERTICAL'?'AUTO':'FIXED';n.counterAxisSizingMode=direction==='VERTICAL'?'FIXED':'AUTO';n.setBoundVariable('itemSpacing',vars['space/'+gap]||vars['space/8']);p.appendChild(n);return place(n,x,y);}
function card(p,name,x,y,w,h,key='cream'){const n=figma.createFrame();n.name=name;n.resize(w,h);n.fills=[paint(key)];n.setBoundVariable('cornerRadius',vars['radius/24']);n.effectStyleId=F.shadow;p.appendChild(n);return place(n,x,y);}
function icon(p,name,x,y,size=24,key='ink'){
 const n=comps[F.icons[name]].createInstance();p.appendChild(n);n.rescale(size/24);for(const v of n.findAllWithCriteria({types:['VECTOR']})){if(Array.isArray(v.fills)&&v.fills.length)v.fills=[paint(key)];if(Array.isArray(v.strokes)&&v.strokes.length)v.strokes=[paint(key)];}return place(n,x,y);
}
function button(p,label,tone,x,y,width=342){const v=F.buttons.variants.find(v=>v.name==='Tone='+tone);const n=comps[v.id].createInstance();n.setProperties({'Label#2:3':label});p.appendChild(n);n.resize(width,64);n.name='Button · '+label;return place(n,x,y);}
function pill(p,label,x,y,width,key='cream',text='ink'){const n=figma.createAutoLayout('HORIZONTAL',{name:'Badge · '+label,itemSpacing:8});n.resize(width,34);n.primaryAxisSizingMode='FIXED';n.counterAxisSizingMode='FIXED';n.primaryAxisAlignItems='CENTER';n.counterAxisAlignItems='CENTER';n.cornerRadius=12;n.fills=[paint(key)];p.appendChild(n);tx(n,label,'Caption',text,12);return place(n,x,y);}
function starRow(p,x,y,size,earned=4,gap=4){const n=stack(p,'Stars · '+earned+'/6',x,y,6*size+5*gap,'HORIZONTAL',gap);n.counterAxisSizingMode='AUTO';for(let i=0;i<6;i++){const c=comps[F.stars[i<earned?0:1].id].createInstance();n.appendChild(c);c.rescale(size/40);}return n;}
const artTargets=[];
function art(p,kind,x=0,y=0,w=390,h=844){const r=rect(p,'Illustration only · '+kind,x,y,w,h,'pale');artTargets.push({id:r.id,kind});return r;}
function gradient(p,name,y,h,top,bottom){const n=figma.createRectangle();n.name=name;n.resize(390,h);n.fills=[{type:'GRADIENT_LINEAR',gradientTransform:[[0,1,0],[-1,0,1]],gradientStops:[{position:0,color:{...rgb(palette.ink),a:top}},{position:1,color:{...rgb(palette.ink),a:bottom}}]}];p.appendChild(n);place(n,0,y);return n;}
const board=figma.createAutoLayout('VERTICAL',{name:'Car Stars · Six screens',itemSpacing:32});board.fills=[{type:'SOLID',color:rgb('#E4EBF2')}];board.paddingTop=32;board.paddingBottom=36;board.paddingLeft=32;board.paddingRight=32;page.appendChild(board);board.x=100;board.y=100;
const title=stack(board,'Presentation heading',0,0,1242);tx(title,'CAR STARS','Display');tx(title,'ЧИСТОВЫЕ ЭКРАНЫ   /   MOBILE 390 × 844','Caption','muted');
const rows=[0,1].map(()=>{const row=figma.createAutoLayout('HORIZONTAL',{name:'Screens row',itemSpacing:36});row.fills=[];board.appendChild(row);return row;});
const screens=[];
function screen(name,row){const col=figma.createAutoLayout('VERTICAL',{name:'Screen column',itemSpacing:12});col.fills=[];rows[row].appendChild(col);tx(col,name,'Caption','muted');const s=figma.createFrame();s.name=name;s.resize(390,844);s.fills=[paint('cream')];s.cornerRadius=24;s.clipsContent=true;col.appendChild(s);screens.push(s);return s;}
const links=[];
function homeIndicator(p){rect(p,'Home indicator',132,825,126,4,'white',2,.8);}
function roleMenu(city){
 const s=screen(city?'02 · Меню — город':'01 · Меню — угонщик',0);
 const split=city?118:292,bot=city?76:250;
 for(const [kind,data] of [['thief',`M0 0 L${split} 0 L${bot} 844 L0 844 Z`],['city',`M${split} 0 L390 0 L390 844 L${bot} 844 Z`]]){
  const v=figma.createVector();v.name='Illustration only · '+kind;v.vectorPaths=[{windingRule:'NONZERO',data}];v.fills=[paint('pale')];v.strokes=[];s.appendChild(v);v.x=kind==='city'?bot:0;v.y=0;artTargets.push({id:v.id,kind});
 }
 const seam=figma.createNodeFromSvg(`<svg width="390" height="844" viewBox="0 0 390 844" xmlns="http://www.w3.org/2000/svg"><path d="M${split} 0 ${bot} 844" stroke="#FFF9EC" stroke-width="5"/></svg>`);s.appendChild(seam);seam.x=0;seam.y=0;seam.name='Diagonal role divider';
 gradient(s,'Bottom legibility gradient',500,344,0,.82);
 const logo=stack(s,'Editable game logo',24,40,280,'VERTICAL',0);const car=tx(logo,'CAR','Display','white',56);const stars=tx(logo,'STARS','Display','gold',56);for(const t of [car,stars]){t.strokes=[paint('ink')];t.strokeWeight=2;t.strokeAlign='OUTSIDE';t.effects=[{type:'DROP_SHADOW',color:{...rgb(palette.ink),a:1},offset:{x:0,y:4},radius:0,spread:0,visible:true,blendMode:'NORMAL'}];}
 const settings=card(s,'Settings',326,40,44,44);icon(settings,'gear',10,10);
 pill(s,'ВЫБЕРИ СТОРОНУ',24,204,190);
 const other=pill(s,city?'УГОНЩИК':'ГОРОД',city?12:284,386,94);other.opacity=.95;
 const selected=pill(s,'✓ ВЫБРАНО',city?192:24,550,140,city?'blue':'gold',city?'white':'ink');
 const info=card(s,'Selected role',24,600,342,116);const content=stack(info,'Role text',18,17,306);
 tx(content,city?'ПРАВООХРАНИТЕЛЬ':'УГОНЩИК','Heading','ink',city?23:28,306);
 tx(content,city?'Управляй городом и патрулями':'Уйди от погони. Забери звёзды.','Body','muted',15,306);
 const play=button(s,'PLAY',city?'Blue':'Gold',24,736);play.paddingLeft=32;icon(s,'play',130,757,22,city?'white':'ink');
 // Invisible role hit areas stay editable and cover their respective scene.
 const thiefHit=rect(s,'Select thief · hit area',0,250,city?104:252,288,'white',0,0);
 const cityHit=rect(s,'Select city · hit area',city?126:290,250,city?264:100,288,'white',0,0);
 links.push({kind:'role-thief',node:thiefHit},{kind:'role-city',node:cityHit},{kind:city?'play-city':'play-thief',node:play});homeIndicator(s);return s;
}
const menuThief=roleMenu(false),menuCity=roleMenu(true);
const gameThief=screen('03 · Игра — угонщик',0);art(gameThief,'thief');
const top=stack(gameThief,'HUD',16,24,358,'HORIZONTAL',8);top.counterAxisSizingMode='AUTO';
const speed=comps[F.metrics[0].id].createInstance();speed.setProperties({'Label#2:8':'СКОРОСТЬ · КМ/Ч','Value#2:9':'112'});speed.resize(108,74);top.appendChild(speed);
const wanted=card(top,'Wanted',0,0,186,74,'ink');const wantedContents=stack(wanted,'Wanted content',10,10,166,'VERTICAL',8);const wt=tx(wantedContents,'РОЗЫСК','Caption','white');wt.textAlignHorizontal='CENTER';wt.resize(166,wt.height);const wstars=starRow(wantedContents,0,0,22,4,4);wstars.x=0;wstars.y=0;
const pause=card(top,'Pause',0,0,48,48);icon(pause,'pause',12,12);links.push({kind:'pause-thief',node:pause});
pill(gameThief,'УЙДИ ОТ ПОГОНИ',98,114,194);
const joy=figma.createEllipse();joy.name='Touch joystick';joy.resize(134,134);joy.fills=[paint('cream',.28)];joy.strokes=[paint('white',.9)];joy.strokeWeight=2;gameThief.appendChild(joy);place(joy,24,662);
const thumb=figma.createEllipse();thumb.name='Joystick thumb';thumb.resize(54,54);thumb.fills=[paint('cream')];thumb.effectStyleId=F.shadow;gameThief.appendChild(thumb);place(thumb,64,702);
const damage=card(gameThief,'Car condition',254,646,112,54);tx(damage,'КУЗОВ 76%','Caption','ink',12);const dt=damage.findAllWithCriteria({types:['TEXT']})[0];place(dt,16,9);rect(damage,'Health track',12,32,88,8,'ink',4);rect(damage,'Health fill',12,32,67,8,'gold',4);
const brake=card(gameThief,'Brake control',280,718,78,78);brake.cornerRadius=39;icon(brake,'brake',22,16,34);tx(brake,'ТОРМОЗ','Caption','ink',9);place(brake.findAllWithCriteria({types:['TEXT']})[0],18,57);links.push({kind:'result-victory',node:damage},{kind:'result-defeat',node:brake});homeIndicator(gameThief);
const gameCity=screen('04 · Игра — управление городом',1);art(gameCity,'city');
const cityTop=stack(gameCity,'City HUD',16,24,358,'HORIZONTAL',8);cityTop.counterAxisSizingMode='AUTO';
for(const [label,value] of [['ПАТРУЛИ','3 / 3'],['ВРЕМЯ','01:24']]){const n=comps[F.metrics[0].id].createInstance();n.setProperties({'Label#2:8':label,'Value#2:9':value});n.resize(147,74);cityTop.appendChild(n);}
const cp=card(cityTop,'Pause',0,0,48,48);icon(cp,'pause',12,12);links.push({kind:'pause-city',node:cp});pill(gameCity,'ПЕРЕХВАТИ УГОНЩИКА',70,114,250,'blue','white');
const routeSvg='<svg width="390" height="844" viewBox="0 0 390 844" xmlns="http://www.w3.org/2000/svg"><path d="M162 238 102 283 176 340 213 387 306 335M96 448 180 384 215 397" fill="none" stroke="#102749" stroke-opacity=".4" stroke-width="8" stroke-linejoin="round"/><path d="M162 238 102 283 176 340 213 387 306 335M96 448 180 384 215 397" fill="none" stroke="#56D9FF" stroke-width="4" stroke-linejoin="round" stroke-dasharray="8 6"/></svg>';
const route=figma.createNodeFromSvg(routeSvg);route.name='Editable patrol routes';gameCity.appendChild(route);place(route,0,0);
for(const [i,x,y] of [[1,145,209],[2,295,315],[3,74,432]]){const marker=pill(gameCity,'0'+i,x,y,38,'blue','white');marker.cornerRadius=19;links.push({kind:'patrol',node:marker});}
const target=figma.createEllipse();target.name='Target highlight';target.resize(62,62);target.fills=[];target.strokes=[paint('gold')];target.strokeWeight=3;gameCity.appendChild(target);place(target,184,443);pill(gameCity,'ЦЕЛЬ',202,502,70,'gold');
const cityInfo=card(gameCity,'Selected patrol',16,642,358,164);const ct=stack(cityInfo,'Patrol content',16,16,326,'VERTICAL',12);
const head=stack(ct,'Patrol heading',0,0,326,'HORIZONTAL',12);head.counterAxisSizingMode='AUTO';icon(head,'shield',0,0,24,'blue');tx(head,'ПАТРУЛЬ 02','Button','ink',20);pill(head,'В ПОГОНЕ',0,0,98,'pale','blue');
tx(ct,'Выбери патруль и укажи маршрут','Body','muted',15,326);
const cbtn=button(ct,'ПЕРЕХВАТИТЬ', 'Blue',0,0,326);cbtn.resize(326,52);links.push({kind:'result-victory',node:cbtn});homeIndicator(gameCity);
function result(win){
 const s=screen(win?'05 · Победа':'06 · Поражение',1);art(s,win?'victory':'defeat');
 const heading=stack(s,'Result heading',24,42,342,'VERTICAL',8);const ht=tx(heading,win?'ПОБЕДА!':'ПОРАЖЕНИЕ','Display',win?'gold':'coral',win?46:35,342);ht.textAlignHorizontal='CENTER';ht.strokes=[paint('ink')];ht.strokeWeight=2;ht.strokeAlign='OUTSIDE';ht.effects=[{type:'DROP_SHADOW',color:{...rgb(palette.ink),a:1},offset:{x:0,y:3},radius:0,spread:0,visible:true,blendMode:'NORMAL'}];
 const sub=pill(heading,win?'ТЫ УШЁЛ ОТ ПОГОНИ':'ТЕБЯ ПОЙМАЛИ',0,0,342);sub.resize(342,34);
 const panel=card(s,'Result summary',24,408,342,286);const column=stack(panel,'Result content',20,20,302,'VERTICAL',12);column.counterAxisAlignItems='CENTER';
 tx(column,win?'ЗАРАБОТАНО ЗВЁЗД':'АРЕСТОВАН','Button','ink',win?20:27);
 if(win){starRow(column,0,0,40,4,8);tx(column,'4 / 6','Display','ink',40);}
 else{tx(column,'Попробуй другой маршрут','Body','muted',16,302);const seal=card(column,'Arrest badge',0,0,64,64,'pale');seal.cornerRadius=32;icon(seal,'shield',16,16,32,'coral');}
 const stats=stack(column,'Result stats',0,0,302,'VERTICAL',8);
 for(const [label,value] of [['Время заезда',win?'02:14':'01:32'],[win?'Повреждения':'Розыск',win?'24%':'4 / 6']]){
  const row=stack(stats,'Statistic',0,0,302,'HORIZONTAL',8);row.primaryAxisAlignItems='SPACE_BETWEEN';row.counterAxisAlignItems='CENTER';tx(row,label,'Body','muted',15);tx(row,value,'Value','ink',22);
 }
 const retry=button(s,win?'ЕЩЁ ЗАЕЗД':'ПОПРОБОВАТЬ СНОВА',win?'Gold':'Blue',24,710);const back=button(s,'В ГЛАВНОЕ МЕНЮ','Secondary',24,782);back.resize(342,44);back.findAllWithCriteria({types:['TEXT']})[0].fontSize=16;links.push({kind:'play-thief',node:retry},{kind:'menu',node:back});return s;
}
const victory=result(true),defeat=result(false);
// Navigation destinations must be page-level frames. Preserve presentation spacing.
const positions=screens.map(s=>({s,x:s.absoluteTransform[0][2],y:s.absoluteTransform[1][2]}));
for(const {s,x,y} of positions){const parent=s.parent,index=parent.children.indexOf(s);const spacer=figma.createRectangle();spacer.name='Screen slot';spacer.resize(390,844);spacer.fills=[];parent.insertChild(index,spacer);page.appendChild(s);place(s,x,y);}
// Explicit prototype navigation; HUD interactions remain visual design proposals.
for(const link of links){let dest;if(link.kind==='role-thief'||link.kind==='menu')dest=menuThief;else if(link.kind==='role-city')dest=menuCity;else if(link.kind==='play-thief')dest=gameThief;else if(link.kind==='play-city')dest=gameCity;else if(link.kind==='result-victory')dest=victory;else if(link.kind==='result-defeat')dest=defeat;else if(link.kind.startsWith('pause'))dest=link.kind==='pause-city'?menuCity:menuThief;else continue;
 let source=link.node;while(source.parent&&source.parent.type!=='PAGE')source=source.parent;if(source.id===dest.id)continue;
 await link.node.setReactionsAsync([{trigger:{type:'ON_CLICK'},actions:[{type:'NODE',destinationId:dest.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:.2,easing:{type:'EASE_OUT'}},preserveScrollPosition:false}]}]);
}
figma.viewport.scrollAndZoomIntoView([board]);
const all=[board,...board.findAll(()=>true),...screens.flatMap(s=>[s,...s.findAll(()=>true)])];
return {createdNodeIds:all.map(n=>n.id),screens:screens.map(n=>({id:n.id,name:n.name,width:n.width,height:n.height})),boardId:board.id,artTargets,links:links.map(l=>({id:l.node.id,kind:l.kind})),bounds:{width:board.width,height:board.height},counts:{text:all.filter(n=>n.type==='TEXT').length,instances:all.filter(n=>n.type==='INSTANCE').length}};
