// Presentation only: every value belongs to the authoritative local player DTO.
export function localHud(gameplay,playerId){
  const player=gameplay?.players.find(p=>p.id===playerId);
  const wanted=player?.wanted??{},arrest=player?.arrest??{};
  return {level:wanted.level??0,pendingStar:wanted.pendingStar??0,state:arrest.state??'idle',
    progress:arrest.state==='holding'?arrest.holdProgress??0:arrest.progress??0,
    remaining:arrest.state==='holding'?Math.ceil((1-(arrest.holdProgress??0))*2):Math.ceil(arrest.remainingSeconds??0)};
}
export function renderOnlineHud(document,gameplay,playerId,visible){
  const $=id=>document.getElementById(id),hud=localHud(visible?gameplay:null,playerId);
  $('wanted').hidden=!visible;
  $('wanted').setAttribute('aria-label',`Розыск: ${hud.level} из 6${hud.pendingStar?', предупреждение':''}`);
  [...document.querySelectorAll('#wanted-stars .wanted-star')].forEach((star,i)=>{
    const pending=hud.pendingStar===i+1;star.dataset.state=i<hud.level?'filled':pending?'pending':'empty';star.classList.toggle('is-warning',pending);
  });
  $('arrest-banner').hidden=!visible||hud.state==='idle';
  $('arrest-status').textContent=hud.state==='holding'?'Полиция удерживает машину — уезжайте, чтобы вырваться':hud.state==='arresting'?'Арест — уезжайте, чтобы вырваться':hud.state==='arrested'?'Арестован':'';
  $('arrest-progress').value=hud.progress;
  $('arrest-progress').setAttribute('aria-valuetext',`${hud.remaining} секунд`);
  $('arrest-timer').textContent=hud.state==='arrested'?'Нажмите R или верните машину':hud.state==='idle'?'':`${hud.remaining} с`;
  $('arrest-restart').hidden=hud.state!=='arrested';$('arrest-restart').textContent='Вернуть машину';
}

// Label leases belong to live visuals. A departed friend releases its ordinal;
// a replacement must not duplicate the remaining friend's name or background.
export function playerLabel(id,localId,usedNumbers=[]){
  if(id===localId)return{number:0,text:'Вы',color:'#ffe29c'};
  const number=[1,2].find(n=>!usedNumbers.includes(n))??1;
  return{number,text:`Друг ${number}`,color:number===1?'#9ddfff':'#c9f49c'};
}
