/* Dethrone Control v1.1 (GitHub) — previsão por data, horário e horas restantes. */
window.DethroneStart = (initialPayload, cloud) => {
  'use strict';
  const KEY = 'dethrone-control-v11';
  const OLD_KEY = 'dethrone-command-v1';
  const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const WEEK_NAMES = ['Qua', 'Qui', 'Sex', 'Sáb', 'Dom', 'Seg', 'Ter'];
  const $ = s => document.querySelector(s);
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => (globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2,10)}`);
  const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = () => dateKey(new Date());
  function fromKey(key){
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key))) return null;
    const [y,m,d] = key.split('-').map(Number);
    const dt = new Date(y,m-1,d,12);
    return dateKey(dt) === key ? dt : null;
  }
  function plusDays(key,num) { const d=fromKey(key); if(!d) return today(); d.setDate(d.getDate()+num); return dateKey(d); }
  function dayOfWeek(key){return fromKey(key)?.getDay() ?? -1;}
  function golemWeekStart(key){const w=dayOfWeek(key);return w<0?today():plusDays(key,-((w-3+7)%7));}
  function fmt(key,options={day:'2-digit',month:'short',year:'numeric'}){const d=fromKey(key);return d?new Intl.DateTimeFormat('pt-BR',options).format(d):'—';}
  function miniDate(key){return fmt(key,{day:'2-digit',month:'2-digit'});}
  function isoTime(){return new Date().toISOString();}
  const bound=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
  const norm=x=>String(x||'').trim().toLocaleLowerCase('pt-BR');
  function shifts(day){
    const w=dayOfWeek(day);
    if(w===2) return [{id:'morning',max:2,label:'Manhã (07h–09h)'}];
    if([1,3,4].includes(w))return [{id:'morning',max:2,label:'Manhã (07h–09h)'},{id:'night',max:2,label:'Noite (19h–21h)'}];
    return [{id:'night',max:4,label:'Noite (17h–21h)'}];
  }
  const parties = [
    {id:'pt1',name:'PT 1',members:['GolemA1','GolemA2','GolemA3','GolemA4','GolemA5']},
    {id:'pt2',name:'PT 2',members:['GolemB1','GolemB2','GolemB3','GolemB4','GolemB5']},
    {id:'pt3',name:'PT 3',members:['GolemC1','GolemC2','GolemC3','GolemC4','GolemC5']},
    {id:'pt4',name:'PT 4',members:['GolemD1','GolemD2','GolemD3','GolemD4','GolemD5']}
  ];
  function demo(){return {
    version:2, demo:true, migrated:false,
    clients:[{id:'demo-client',name:'Cliente de exemplo',startDate:'2026-11-04',startShift:'night',planDays:30,status:'active',characters:[{id:'demo-char',name:'Personagem de exemplo'}],demo:true}],
    logs:[
      {clientId:'demo-client',charId:'demo-char',date:'2026-11-04',shift:'night',hours:2},
      {clientId:'demo-client',charId:'demo-char',date:'2026-11-05',shift:'morning',hours:2},
      {clientId:'demo-client',charId:'demo-char',date:'2026-11-05',shift:'night',hours:2}
    ],
    golems:[],legacyBosses:[],legacyParties:[]
  };}
  function empty(){return {version:2,demo:false,migrated:false,clients:[],logs:[],golems:[],legacyBosses:[],legacyParties:[]};}
  function migrateOld(old){
    if(!old||!Array.isArray(old.clients)||!Array.isArray(old.sessions))throw Error('Backup antigo inválido');
    return {
      version:2,demo:!!old.demo,migrated:true,
      clients:old.clients.map(c=>({id:c.id,name:c.name,startDate:c.startDate,startShift:c.startShift||'morning',planDays:c.planDays||30,status:c.status||'active',characters:c.characters||[],demo:!!c.demo})),
      logs:old.sessions.filter(s=>fromKey(s.date)).map(s=>({clientId:s.clientId,charId:s.charId,date:s.date,shift:s.shift,hours:s.shift==='morning'?2:([0,5,6].includes(dayOfWeek(s.date))?4:2)})),
      golems:[],legacyBosses:old.bosses||[],legacyParties:old.parties||[]
    };
  }
  function validate(v){
    return !!v && Array.isArray(v.clients) && Array.isArray(v.logs) && Array.isArray(v.golems) && v.clients.length<=300 && v.logs.length<=80000 && v.golems.length<=150000 && v.clients.every(c=>typeof c.id==='string'&&typeof c.name==='string'&&fromKey(c.startDate)&&Number.isInteger(c.planDays)&&c.planDays>=1&&c.planDays<=365&&['morning','night'].includes(c.startShift)&&Array.isArray(c.characters)&&c.characters.length<=200&&c.characters.every(ch=>typeof ch.id==='string'&&typeof ch.name==='string')) && v.logs.every(l=>typeof l.clientId==='string'&&typeof l.charId==='string'&&fromKey(l.date)&&['morning','night'].includes(l.shift)&&Number.isInteger(l.hours)&&l.hours>=0&&l.hours<=4) && v.golems.every(g=>fromKey(g.date)&&typeof g.partyId==='string'&&typeof g.character==='string');
  }
  // Os dados vêm do Supabase DEPOIS do PIN ser validado no servidor.
  // O antigo localStorage é apenas uma fonte opcional para migração manual.
  let state = initialPayload ? structuredClone(initialPayload) : empty();
  if (!validate(state)) throw Error('O banco retornou dados incompatíveis. Nenhum registro foi alterado.');
  // Versões anteriores podiam registrar o mesmo personagem várias vezes no dia.
  // Preservamos uma participação por personagem/data sem apagar outros dados.
  function deduplicateGolems(){
    const seen=new Set();
    state.golems=state.golems.filter(g=>{
      const key=JSON.stringify([g.partyId,g.character,g.date]);
      if(seen.has(key))return false;
      seen.add(key);return true;
    });
    state.version=3;
  }
  deduplicateGolems();
  const ui={tab:'service',clientId:state.clients[0]?.id||'',serviceDate:today(),golemDate:today(),week:golemWeekStart(today())};
  function save(){
    // A fila guarda uma cópia pendente neste navegador antes de enviar ao Supabase.
    cloud.push(state);
    return true;
  }
  cloud.onRemote(remote => {
    if (!validate(remote)) { toast('A nuvem retornou dados inválidos. Nenhuma alteração aplicada.',true); return; }
    state=structuredClone(remote);
    deduplicateGolems();
    ui.clientId=state.clients.some(c=>c.id===ui.clientId)?ui.clientId:(state.clients[0]?.id||'');
    closeModal();render();
  });
  function toast(txt,bad=false){const el=document.createElement('div');el.className=`toast ${bad?'error':''}`;el.textContent=txt;$('#toast-root').append(el);setTimeout(()=>el.remove(),3600);}
  const getClient=id=>state.clients.find(c=>c.id===id);
  function getHours(clientId,charId,date,shift){return state.logs.find(l=>l.clientId===clientId&&l.charId===charId&&l.date===date&&l.shift===shift)?.hours||0;}
  function allowed(client,date,shift){
    return date>=client.startDate&&!(date===client.startDate&&client.startShift==='night'&&shift==='morning');
  }
  function completeDay(client,ch,date){
    if(date<client.startDate)return false;
    const schedule=shifts(date);
    return schedule.every(s=>allowed(client,date,s.id)&&getHours(client.id,ch.id,date,s.id)>=s.max);
  }
  function recordedHours(client,ch){return state.logs.filter(l=>l.clientId===client.id&&l.charId===ch.id).reduce((s,l)=>s+l.hours,0);}
  function dayProgress(client,ch,date){
    const s=shifts(date),total=s.reduce((a,x)=>a+x.max,0);
    const actual=s.reduce((a,x)=>a+(allowed(client,date,x.id)?getHours(client.id,ch.id,date,x.id):0),0);
    return {actual,total,complete:actual===total&&s.every(x=>allowed(client,date,x.id))};
  }
  function completedCount(client,ch){
    if(today()<client.startDate)return 0;
    let n=0,d=client.startDate;
    for(let i=0;i<1100&&d<=today();i++,d=plusDays(d,1))if(completeDay(client,ch,d))n++;
    return n;
  }
  function projected(client,ch){
    let n=0,d=client.startDate;
    for(let i=0;i<1500;i++,d=plusDays(d,1)){
      const sched=shifts(d),eligible=sched.every(s=>allowed(client,d,s.id));
      // Dias anteriores ao atual devem estar 100% marcados; hoje e futuro são estimados.
      const qualifies=eligible && (d<today()?completeDay(client,ch,d):true);
      if(qualifies) n++;
      if(n>=client.planDays)return d;
    }
    return null;
  }
  function clientProgress(client){return client.characters.length?Math.min(...client.characters.map(ch=>completedCount(client,ch))):0;}
  function clientProjected(client){return client.characters.length?client.characters.map(ch=>projected(client,ch)).filter(Boolean).sort().at(-1)||null:null;}
  function clientHours(client){return client.characters.reduce((x,ch)=>x+recordedHours(client,ch),0);}
  // A hora de término é a do ÚLTIMO turno previsto para o dia final.
  // Terça: manhã até 09h; todos os outros dias: noite até 21h.
  function finishClock(date){
    if(!date)return '—';
    const last=shifts(date).at(-1);
    return last?.id==='morning'?'09h':'21h';
  }
  function forecastDetails(client,ch){
    const date=projected(client,ch);
    if(!date)return {date:null,time:'—',hoursRemaining:0};
    const completed=completedCount(client,ch);
    if(completed>=client.planDays)return {date,time:finishClock(date),hoursRemaining:0};
    // Somam-se SOMENTE as horas das sessões que ainda poderão compor
    // os dias completos restantes. Horas parciais de dias já passados
    // são mantidas no histórico, mas não contam como dias completos.
    // As horas já realizadas HOJE são subtraídas do saldo previsto.
    let hoursRemaining=0;
    let day=client.startDate>today()?client.startDate:today();
    for(let i=0;i<1500 && day<=date;i++,day=plusDays(day,1)){
      const schedule=shifts(day);
      if(schedule.some(shift=>!allowed(client,day,shift.id)))continue;
      for(const shift of schedule){
        const done=day===today()?getHours(client.id,ch.id,day,shift.id):0;
        hoursRemaining+=Math.max(0,shift.max-done);
      }
    }
    return {date,time:finishClock(date),hoursRemaining};
  }
  function clientForecastDetails(client){
    if(!client?.characters?.length)return null;
    const details=client.characters.map(ch=>forecastDetails(client,ch));
    const last=details.filter(item=>item.date).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
    if(!last)return null;
    // Personagens podem jogar em paralelo: não somar horas de personagens.
    // O maior saldo individual indica a maior quantidade de horas pendentes.
    return {date:last.date,time:last.time,hoursRemaining:Math.max(...details.map(item=>item.hoursRemaining))};
  }
  function forecastLabel(info){return info?.date?`${fmt(info.date,{day:'2-digit',month:'2-digit',year:'numeric'})} · ${info.time}`:'—';}
  // Cada personagem participa no máximo uma vez por dia.
  function golemDone(partyId,character,date){
    return state.golems.some(g=>g.partyId===partyId&&g.character===character&&g.date===date);
  }
  function weekDates(){return Array.from({length:7},(_,i)=>plusDays(ui.week,i));}
  function weekCount(partyId,char){
    const first=ui.week,last=plusDays(first,6);
    return new Set(state.golems.filter(g=>g.partyId===partyId&&g.character===char&&g.date>=first&&g.date<=last).map(g=>g.date)).size;
  }
  const weeklyComplete=()=>parties.reduce((sum,p)=>sum+p.members.filter(ch=>weekCount(p.id,ch)>=3).length,0);
  function render(){
    document.querySelectorAll('[data-tab]').forEach(btn=>{const selected=ui.tab===btn.dataset.tab;btn.classList.toggle('active',selected);btn.setAttribute('aria-selected',selected?'true':'false');});
    $('#main-content').innerHTML=ui.tab==='service'?renderService():renderGolem();
  }
  function renderService(){
    const active=state.clients.filter(c=>c.status==='active'&&clientProgress(c)<c.planDays).length;
    const current=getClient(ui.clientId)||state.clients[0];
    if(current)ui.clientId=current.id;
    const forecast=current?clientForecastDetails(current):null;
    return `
      <div class="stat-row"><div class="stat"><span class="stat-label">Services ativos</span><strong>${active}</strong><small>clientes em andamento</small></div>
      <div class="stat"><span class="stat-label">Dias concluídos ${current?'(selecionado)':''}</span><strong class="gold">${current?clientProgress(current):'0'}<span style="color:#748297;font-size:17px">/${current?.planDays||30}</span></strong><small>somente dias completos</small></div>
      <div class="stat"><span class="stat-label">Previsão de término</span><strong class="forecast-date">${forecastLabel(forecast)}</strong><small class="forecast-hours">${forecast?`◷ ${forecast.hoursRemaining}h restantes de Dethrone`:'Aguardando cadastro'}</small></div></div>
      <section class="panel"><div class="panel-header"><div><h2>Meus services</h2><p>Escolha um cliente ou cadastre um novo.</p></div><button class="btn primary btn-small" data-action="new-client">＋ Novo service</button></div>
      <div class="panel-body">${state.migrated?`<div class="notice" style="margin-bottom:13px">Dados da versão anterior recuperados. As sessões antigas foram importadas como horas completas. Os antigos bosses estão guardados no backup, mas não contam para a nova meta individual.</div>`:''}
        ${state.demo?`<div class="hint" style="margin:0 0 14px"><span>✦</span><span>Há um service de exemplo iniciado em 04/11/2026 à noite. <button class="btn btn-small ghost" style="margin-left:9px" data-action="remove-demo">Remover exemplo</button></span></div>`:''}
        ${state.clients.length?`<div class="client-strip">${state.clients.map(c=>`<button class="client-choice ${current?.id===c.id?'active':''}" data-action="select-client" data-id="${esc(c.id)}">${esc(c.name)}<small>${clientProgress(c)}/${c.planDays}</small></button>`).join('')}</div>`:''}
        ${current?renderClient(current):`<div class="empty-state"><div class="empty-icon">◷</div><h2>Nenhum service cadastrado</h2><p>Adicione o primeiro cliente e os personagens para começar a controlar horas e datas.</p><button class="btn primary" data-action="new-client">＋ Cadastrar service</button></div>`}
      </div></section>`;
  }
  function renderClient(c){
    const progress=clientProgress(c),end=clientForecastDetails(c),totalH=clientHours(c),day=ui.serviceDate;
    const isFinished=progress>=c.planDays;
    const schedule=shifts(day);
    const upcoming=day>=c.startDate;
    const canMark=day<=today()&&upcoming;
    const completion=Math.round(Math.min(100,progress/c.planDays*100));
    return `<div class="service-summary"><div><h2>${esc(c.name)}</h2><p>Início: <b>${fmt(c.startDate)}</b> · ${c.startShift==='night'?'somente à noite':'pela manhã'} · ${c.characters.length} personagem(ns)</p>
      <div class="meta-tags"><span class="tag ${isFinished?'good':''}">${isFinished?'✓ Pacote concluído':`${progress}/${c.planDays} dias completos`}</span><span class="tag">◷ ${totalH}h registradas</span>${c.status==='paused'?'<span class="tag warn">Pausado</span>':''}<span class="tag ${isFinished?'good':'warn'}">${isFinished?'Finalizado':'Previsão: '+forecastLabel(end)}</span></div></div>
      <div class="toolbar"><button class="btn btn-small secondary" data-action="edit-client" data-id="${esc(c.id)}">✎ Editar</button><button class="btn btn-small danger" data-action="delete-client" data-id="${esc(c.id)}">Excluir</button></div></div>
      <div class="progressbar"><i style="width:${completion}%"></i></div>
      <p class="guide"><b>Contagem:</b> o dia só conta quando todas as horas previstas forem cumpridas. Você pode marcar 1h, 2h, 3h ou 4h; as horas parciais ficam registradas. Dias incompletos já passados adiam a previsão. <b>Horas restantes:</b> saldo de sessões necessárias para completar o pacote, considerando as horas feitas hoje; em services com vários personagens, aparece o maior saldo individual, sem somar horas simultâneas.</p>
      <div class="divider"></div>
      <div class="date-tools"><div><h2 style="margin-bottom:3px">Registro diário</h2><p style="font-size:11px;margin:0">Marque quantas horas cada personagem fez.</p></div>
        <div class="date-navigator"><button class="btn btn-icon secondary" data-action="service-prev" aria-label="Dia anterior">‹</button><input class="date-input" id="service-date" type="date" value="${day}" max="${today()}" aria-label="Data do Dethrone"><button class="btn btn-icon secondary" data-action="service-next" aria-label="Próximo dia" ${day>=today()?'disabled':''}>›</button><button class="btn btn-small ghost" data-action="service-today">Hoje</button></div></div>
      <div class="summary-line"><span class="tag">${WEEKDAYS[dayOfWeek(day)]}, ${fmt(day)}</span>${schedule.map(s=>`<span class="tag">${s.label}</span>`).join('')}${!upcoming?'<span class="tag warn">Antes do início do pacote</span>':''}</div>
      <div class="table-wrap"><table class="daily-table"><thead><tr><th>Personagem</th><th>Manhã</th><th>Noite</th><th>Dia</th></tr></thead><tbody>
      ${c.characters.map(ch=>{
        const dp=dayProgress(c,ch,day);
        const status=dp.complete?'<span class="status-text complete">✓ Completo</span>':dp.actual?`<span class="status-text partial">${dp.actual}h/${dp.total}h</span>`:'<span class="status-text">Pendente</span>';
        const morning=schedule.find(x=>x.id==='morning'),night=schedule.find(x=>x.id==='night');
        const selector=(shift)=>{
          if(!shift)return '<span class="hours-disabled">—</span>';
          if(!allowed(c,day,shift.id))return '<span class="hours-disabled">Não incluso</span>';
          const value=getHours(c.id,ch.id,day,shift.id);
          return `<div class="hours-select" role="group" aria-label="${esc(ch.name)} — ${shift.id==='morning'?'manhã':'noite'}">${Array.from({length:shift.max+1},(_,n)=>`<button type="button" class="hours-btn ${n===value?'selected':''} ${n===0&&n===value?'zero':''}" aria-pressed="${n===value?'true':'false'}" aria-label="${n} horas para ${esc(ch.name)}" data-action="set-hours" data-client="${esc(c.id)}" data-char="${esc(ch.id)}" data-date="${day}" data-shift="${shift.id}" data-hours="${n}" ${!canMark?'disabled':''}>${n}h</button>`).join('')}</div>`;
        };
        return `<tr><td class="char-name">${esc(ch.name)}</td><td>${selector(morning)}</td><td>${selector(night)}</td><td>${upcoming?status:'<span class="status-text">Fora do pacote</span>'}</td></tr>`;
      }).join('')}</tbody></table></div>
      <div class="toolbar" style="margin-top:13px"><button class="btn btn-small secondary" data-action="fill-day" ${!canMark?'disabled':''}>✓ Completar horas do dia (todos)</button><button class="btn btn-small ghost" data-action="clear-day" ${!canMark?'disabled':''}>Limpar dia</button>${state.demo?'<button class="btn btn-small ghost" data-action="see-demo">Ver 04/11 (exemplo)</button>':''}</div>
      <div class="divider"></div><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><h3>Andamento por personagem</h3><span style="color:#8699ac;font-size:11px">Previsão revisada automaticamente</span></div>
      <div class="members-list" style="margin-top:12px">${c.characters.map(ch=>{
        const n=completedCount(c,ch),d=forecastDetails(c,ch);
        return `<div class="member-progress"><div><strong>${esc(ch.name)}</strong><small style="display:block">${recordedHours(c,ch)}h realizadas</small></div><div><strong style="color:${n>=c.planDays?'#74d9ad':'#f4bd6b'}">${n}/${c.planDays}</strong><small style="display:block">dias</small></div><div><div class="meter"><i style="width:${Math.min(100,n/c.planDays*100)}%"></i></div><small>Previsão: ${forecastLabel(d)}</small><small class="char-hours-left">◷ ${d.hoursRemaining}h restantes</small></div></div>`;
      }).join('')}</div>`;
  }
  function renderGolem(){
    const days=weekDates(),complete=weeklyComplete(),marked=state.golems.filter(g=>g.date>=days[0]&&g.date<=days[6]).length;
    const weekEnd=days[6],isThisWeek=days.includes(today());
    return `<div class="stat-row"><div class="stat"><span class="stat-label">Personagens com meta</span><strong class="green">${complete}<span style="font-size:16px;color:#8191a5">/20</span></strong><small>fizeram pelo menos 3 Golems</small></div>
      <div class="stat"><span class="stat-label">Participações na semana</span><strong>${marked}</strong><small>máximo de 1 por personagem ao dia</small></div>
      <div class="stat"><span class="stat-label">Meta por personagem</span><strong class="gold">3</strong><small>dias de Chaos Golem por semana</small></div></div>
      <section class="panel"><div class="panel-header week-head"><div><h2>Chaos Golem • Controle semanal</h2><p>Semana de quarta a terça. Marque quem fez o boss em cada dia.</p></div>
      <div class="date-navigator"><button class="btn btn-icon secondary" data-action="week-prev" aria-label="Semana anterior">‹</button><input class="date-input" type="date" id="golem-date" value="${ui.golemDate}" aria-label="Escolher semana"><button class="btn btn-icon secondary" data-action="week-next" aria-label="Semana seguinte">›</button><button class="btn btn-small ghost" data-action="week-today">Esta semana</button></div></div>
      <div class="panel-body"><div class="week-head"><div><div class="eyebrow">QUARTA ${fmt(ui.week,{day:'2-digit',month:'short'}).toUpperCase()} → TERÇA ${fmt(weekEnd,{day:'2-digit',month:'short',year:'numeric'}).toUpperCase()}</div><p style="font-size:12px;margin:0">Clique diretamente no dia do personagem: ✓ feito ou · não feito. O dia atual continua destacado. Meta: 3/3.</p></div><div class="week-counter"><strong>${complete}/20</strong><small>metas<br>concluídas</small></div></div>
      <div class="progressbar"><i style="width:${complete/20*100}%"></i></div></div></section>
      <div class="pt-grid">${parties.map(p=>renderParty(p,days,isThisWeek)).join('')}</div>
      <div class="explain" style="margin-top:17px"><strong>Como usar:</strong> clique no quadradinho para marcar <b>✓ Feito</b> ou desmarcar. Para vários de uma PT, use <b>Marcar PT</b> e desmarque quem desconectou. Pode abrir de novo para corrigir, sem bloqueio. Cada personagem conta <b>no máximo 1 Golem por dia</b>; a semana vai de <b>quarta a terça</b>.</div>`;
  }
  function renderParty(p,days,isThisWeek){
    const doneMembers=p.members.filter(ch=>weekCount(p.id,ch)>=3).length;
    const bulkDay=days.includes(ui.golemDate)?ui.golemDate:(isThisWeek?today():days[0]);
    return `<section class="pt-card"><div class="pt-card-head"><div><div class="name">⚔ ${p.name}</div><p>${p.members.length} personagens • meta 3 por semana</p></div><span class="pt-badge">${doneMembers}/5 concluídos</span></div>
    <div class="pt-table-wrap"><table class="pt-table"><thead><tr><th>PERSONAGEM</th>${days.map((d,i)=>`<th class="${d===today()?'today-col':''}">${WEEK_NAMES[i]}<span>${miniDate(d)}</span></th>`).join('')}<th>SEMANA</th></tr></thead>
    <tbody>${p.members.map(ch=>{
      const n=weekCount(p.id,ch);
      return `<tr><td><strong>${esc(ch)}</strong></td>${days.map(d=>{
        const done=golemDone(p.id,ch,d);
        return `<td><button class="golem-cell ${done?'checked':''} ${d===today()?'today':''}" type="button" aria-pressed="${done}" aria-label="${esc(ch)}: ${done?'feito':'não feito'} em ${fmt(d)}. Clique para ${done?'desmarcar':'marcar'}" title="${esc(ch)} • ${fmt(d)} • ${done?'Feito ✓':'Não feito ·'}. Clique para alterar." data-action="golem-toggle" data-party="${p.id}" data-char="${esc(ch)}" data-date="${d}" ${d>today()?'disabled':''}>${done?'✓':'·'}</button></td>`;
      }).join('')}<td><span class="week-count ${n>=3?'done':''}">${n}/3 ${n>=3?'✓':''}</span></td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="pt-card-foot"><small>${doneMembers===5?'✓ PT inteira completou a quest':`${5-doneMembers} personagem(ns) ainda precisam completar`}</small><button class="btn btn-small secondary" data-action="golem-bulk" data-party="${p.id}" data-date="${bulkDay}" ${bulkDay>today()?'disabled':''}>✓ Marcar PT • ${miniDate(bulkDay)}</button></div></section>`;
  }
  function modal(title,body,footer=''){
    $('#modal-root').innerHTML=`<div class="modal-shade" data-action="outside"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="btn secondary btn-small" data-action="close-modal" aria-label="Fechar">✕</button></div><div class="modal-body">${body}</div>${footer?`<div class="modal-foot">${footer}</div>`:''}</div></div>`;
  }
  const closeModal=()=>$('#modal-root').replaceChildren();
  function clientForm(old){
    modal(old?'Editar service':'Novo service',`<form id="client-form" data-edit="${esc(old?.id||'')}">
      <div class="field-grid"><div class="field wide"><label for="c-name">Cliente / identificação do service</label><input id="c-name" name="name" maxlength="100" placeholder="Ex.: Cliente 01" value="${esc(old?.name||'')}" required></div>
      <div class="field"><label for="c-start">Data de início</label><input id="c-start" type="date" name="startDate" value="${old?.startDate||today()}" required></div>
      <div class="field"><label for="c-shift">Primeira sessão</label><select id="c-shift" name="startShift"><option value="morning" ${old?.startShift==='morning'?'selected':''}>Manhã</option><option value="night" ${old?.startShift==='night'?'selected':''}>Noite (sem manhã do início)</option></select></div>
      <div class="field"><label for="c-plan">Pacote (dias completos)</label><input id="c-plan" type="number" name="planDays" min="1" max="365" value="${old?.planDays||30}" required></div>
      <div class="field"><label for="c-status">Situação</label><select id="c-status" name="status"><option value="active" ${old?.status!=='paused'?'selected':''}>Ativo</option><option value="paused" ${old?.status==='paused'?'selected':''}>Pausado</option></select></div>
      <div class="field wide"><label for="c-chars">Personagens (um nome por linha)</label><textarea name="characters" id="c-chars" required placeholder="Char1&#10;Char2&#10;Char3">${esc(old?.characters?.map(ch=>ch.name).join('\n')||'')}</textarea><small>Cada personagem tem sua própria contagem de horas e de dias completos. Ao renomear, preservamos o registro pelo nome anterior somente se ele continuar igual.</small></div></div>
      <div class="modal-foot" style="padding:16px 0 0;border:0"><button type="button" class="btn secondary" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Salvar service</button></div></form>`);
  }
  function backupModal(){
    modal('Nuvem e backup',`<div class="backup-row"><h3>☁ Supabase conectado</h3><p>Todos os PINs acessam o mesmo espaço na nuvem. O indicador no cabeçalho mostra se as alterações foram sincronizadas.</p></div>
      <div class="backup-row"><h3>⇩ Exportar backup JSON</h3><p>Baixa uma cópia atual dos services, horas e participações no Golem.</p><button class="btn primary" data-action="export">Baixar backup</button></div>
      <div class="backup-row"><h3>⇧ Importar backup</h3><p>Importar substitui os dados de todos os dispositivos; confirme somente quando desejar.</p><button class="btn secondary" data-action="import">Selecionar arquivo JSON</button></div>
      ${cloud.hasLegacy()?`<div class="backup-row"><h3>↥ Migrar v1.3 deste navegador</h3><p>Encontramos dados antigos gravados neste navegador. Importe-os uma única vez para a nuvem, sem apagar a cópia original.</p><button class="btn secondary" data-action="import-legacy">Importar dados antigos</button></div>`:''}
      <div class="backup-row"><h3>Exclusão / começar de novo</h3><p class="warning">Apaga os registros no espaço compartilhado do Supabase, inclusive nos outros dispositivos após sincronizarem.</p><button class="btn danger" data-action="reset">Apagar registros da nuvem</button></div>
      <div class="notice">Se estiver sem internet, as alterações ficam pendentes neste navegador até conseguir sincronizar. Mantenha backups JSON periódicos.</div>`);
  }
  function saveClient(form){
    const fd=new FormData(form),name=String(fd.get('name')||'').trim();
    const startDate=String(fd.get('startDate')||'');
    let startShift=String(fd.get('startShift'));
    if(fromKey(startDate)&&![1,2,3,4].includes(dayOfWeek(startDate)))startShift='night';
    const planDays=Number(fd.get('planDays'));
    const names=[...new Set(String(fd.get('characters')||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean))];
    if(!name||!fromKey(startDate)||!['morning','night'].includes(startShift)||!Number.isInteger(planDays)||planDays<1||planDays>365||!names.length||names.length>200){toast('Preencha corretamente os dados e ao menos um personagem.',true);return;}
    const w=dayOfWeek(startDate);
    if(startShift==='night'&&w===2) {startShift='morning';}
    const old=getClient(form.dataset.edit);
    const characters=names.map(n=>({id:old?.characters?.find(c=>norm(c.name)===norm(n))?.id||uid(),name:n}));
    if(old){
      const retained=new Set(characters.map(ch=>ch.id));
      if(old.characters.some(ch=>!retained.has(ch.id))&&!confirm('Remover personagens do service também apagará os registros de horas deles. Continuar?'))return;
      state.logs=state.logs.filter(l=>l.clientId!==old.id||retained.has(l.charId));
      Object.assign(old,{name,startDate,startShift,planDays,status:fd.get('status')||'active',characters});
    }else{
      const item={id:uid(),name,startDate,startShift,planDays,status:fd.get('status')||'active',characters,demo:false};
      state.clients.push(item);ui.clientId=item.id;
    }
    closeModal();save();render();toast('Service salvo com sucesso.');
  }
  function setHours(el){
    const c=getClient(el.dataset.client),ch=c?.characters?.find(x=>x.id===el.dataset.char),day=el.dataset.date,shift=el.dataset.shift,hours=Number(el.dataset.hours);
    const slot=fromKey(day)?shifts(day).find(x=>x.id===shift):null;
    if(!c||!ch||!slot||!Number.isInteger(hours)||hours<0||hours>slot.max||!allowed(c,day,shift)||day>today()){toast('Registro inválido.',true);return;}
    state.logs=state.logs.filter(l=>!(l.clientId===c.id&&l.charId===ch.id&&l.date===day&&l.shift===shift));
    if(hours>0)state.logs.push({clientId:c.id,charId:ch.id,date:day,shift,hours,updatedAt:isoTime()});
    save();render();toast(`${ch.name}: ${hours}h ${shift==='morning'?'manhã':'noite'} • ${fmt(day)}.`);
  }
  function bulkService(clear=false){
    const c=getClient(ui.clientId),day=ui.serviceDate;
    if(!c||day>today()||day<c.startDate)return;
    if(clear&&!confirm(`Limpar todas as horas dos personagens em ${fmt(day)}?`))return;
    const keys=new Set(c.characters.map(ch=>ch.id));
    state.logs=state.logs.filter(l=>!(l.clientId===c.id&&keys.has(l.charId)&&l.date===day));
    if(!clear)for(const ch of c.characters)for(const sh of shifts(day))if(allowed(c,day,sh.id))state.logs.push({clientId:c.id,charId:ch.id,date:day,shift:sh.id,hours:sh.max,updatedAt:isoTime()});
    save();render();toast(clear?'Dia limpo.':'Dia registrado para todos os personagens.');
  }
  function golemRegisterModal(partyId,date){
    const party=parties.find(p=>p.id===partyId);
    if(!party||!fromKey(date)||date>today())return;
    const already=party.members.some(ch=>golemDone(party.id,ch,date));
    modal(`Marcar Chaos Golem • ${party.name}`,`<form id="golem-register-form" data-party="${party.id}">
      <div class="golem-register-intro">Marque os personagens que <b>fizeram o Chaos Golem</b> nesta data. Desmarque quem desconectou. Cada personagem só pode ter <b>uma marcação por dia</b>. Você pode voltar e corrigir a qualquer momento.</div>
      <div class="field"><label for="register-golem-date">Data do Golem</label><input type="date" id="register-golem-date" name="date" value="${date}" max="${today()}" required></div>
      <div class="roster-heading"><strong>Quem fez?</strong><div><button type="button" class="btn btn-small ghost" data-action="golem-select-all">Marcar todos</button><button type="button" class="btn btn-small ghost" data-action="golem-select-none">Desmarcar todos</button></div></div>
      <div class="golem-roster">${party.members.map(ch=>`<label class="golem-roster-item"><input type="checkbox" name="character" value="${esc(ch)}" ${!already||golemDone(party.id,ch,date)?'checked':''}><span>${esc(ch)}</span><small>${weekCount(party.id,ch)}/3 nesta semana</small></label>`).join('')}</div>
      <div class="modal-foot" style="padding:16px 0 0;border:0"><button type="button" class="btn secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn primary">✓ Salvar marcações</button></div>
    </form>`);
  }
  function updateGolemRoster(date){
    const form=document.querySelector('#golem-register-form');
    if(!form||!fromKey(date)||date>today())return;
    const party=parties.find(p=>p.id===form.dataset.party);if(!party)return;
    const hasMarks=party.members.some(ch=>golemDone(party.id,ch,date));
    for(const input of form.querySelectorAll('input[name="character"]')){
      input.checked=!hasMarks||golemDone(party.id,input.value,date);
      const hint=input.closest('label')?.querySelector('small');
      if(hint){
        const first=golemWeekStart(date),last=plusDays(first,6);
        const weekly=new Set(state.golems.filter(g=>g.partyId===party.id&&g.character===input.value&&g.date>=first&&g.date<=last).map(g=>g.date)).size;
        hint.textContent=`${weekly}/3 nesta semana`;
      }
    }
  }
  function registerGolem(form){
    const party=parties.find(p=>p.id===form.dataset.party),date=String(new FormData(form).get('date')||'');
    if(!party||!fromKey(date)||date>today()){toast('Escolha uma data válida até hoje.',true);return;}
    const selected=new Set([...form.querySelectorAll('input[name="character"]:checked')].map(x=>x.value).filter(ch=>party.members.includes(ch)));
    // Salvar equivale ao estado final de cada personagem no dia, sem somar participações.
    state.golems=state.golems.filter(g=>!(g.partyId===party.id&&g.date===date&&party.members.includes(g.character)));
    for(const character of selected)state.golems.push({id:uid(),date,partyId:party.id,character,updatedAt:isoTime()});
    ui.golemDate=date;ui.week=golemWeekStart(date);
    save();closeModal();render();toast(`${party.name}: marcações de ${fmt(date)} salvas (${selected.size}/5 fizeram).`);
  }
  function toggleGolem(el){
    const partyId=el.dataset.party,char=el.dataset.char,date=el.dataset.date;
    const party=parties.find(p=>p.id===partyId);
    if(!party||!party.members.includes(char)||!fromKey(date)||date>today())return;
    if(golemDone(partyId,char,date)){
      state.golems=state.golems.filter(g=>!(g.partyId===partyId&&g.character===char&&g.date===date));
    }else{
      state.golems.push({id:uid(),date,partyId,character:char,updatedAt:isoTime()});
    }
    save();render();
  }
  function downloadBackup(){
    const blob=new Blob([JSON.stringify({...state,version:3,exportedAt:isoTime()},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`dethrone-backup-${today()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('Backup JSON exportado.');
  }
  function importLegacy(){
    if(!cloud.hasLegacy()){toast('Não encontrei dados antigos neste navegador.',true);return;}
    let migrated;
    try {
      const old=cloud.legacyJson();
      migrated=Array.isArray(old?.sessions)&&!Array.isArray(old.logs)?migrateOld(old):old;
      if(!validate(migrated))throw Error('O conteúdo antigo não é compatível.');
    } catch(err){toast(`Falha na migração: ${err.message}`,true);return;}
    if(!confirm('Importar os dados antigos da v1.3 para a nuvem? Essa ação substituirá os dados atuais de todos os dispositivos, mas preservará a cópia antiga neste navegador.'))return;
    state={...empty(),...migrated};deduplicateGolems();
    ui.clientId=state.clients[0]?.id||'';
    ui.tab='service';closeModal();save();render();
    cloud.notice('Importação solicitada. Confirme o status "Salvo na nuvem" antes de sair.');
    toast('Importação iniciada: acompanhe a sincronização no cabeçalho.');
  }
  window.DethroneApp={exportBackup:downloadBackup,importLegacy};
  function removeDemo(){
    if(!state.clients.some(c=>c.demo))return;
    if(!confirm('Remover o service e as horas de exemplo? Os demais registros serão mantidos.'))return;
    const ids=new Set(state.clients.filter(c=>c.demo).map(c=>c.id));
    state.clients=state.clients.filter(c=>!c.demo);state.logs=state.logs.filter(l=>!ids.has(l.clientId));state.demo=false;
    ui.clientId=state.clients[0]?.id||'';save();render();toast('Exemplo removido.');
  }
  function reset(){
    if(!confirm('Apagar todos os services, horas e registros de Golem da nuvem compartilhada?'))return;
    if(!confirm('Última confirmação: já exportou um backup?'))return;
    state=empty();ui.clientId='';save();closeModal();render();toast('Dados apagados.');
  }
  function deleteClient(id){
    const c=getClient(id);if(!c||!confirm(`Excluir "${c.name}" e todas as horas dos seus personagens?`))return;
    state.clients=state.clients.filter(x=>x.id!==id);state.logs=state.logs.filter(x=>x.clientId!==id);
    ui.clientId=state.clients[0]?.id||'';state.demo=state.clients.some(c=>c.demo);save();render();toast('Service excluído.');
  }
  document.addEventListener('click',e=>{
    const el=e.target.closest('[data-tab],[data-action]');if(!el)return;
    if(el.dataset.tab){ui.tab=el.dataset.tab;render();return;}
    if(el.dataset.action==='outside'&&e.target!==el)return;
    const action=el.dataset.action;
    switch(action){
      case 'new-client':clientForm();break;
      case 'edit-client':clientForm(getClient(el.dataset.id));break;
      case 'delete-client':deleteClient(el.dataset.id);break;
      case 'select-client':ui.clientId=el.dataset.id;render();break;
      case 'set-hours':setHours(el);break;
      case 'fill-day':bulkService();break;
      case 'clear-day':bulkService(true);break;
      case 'service-prev':ui.serviceDate=plusDays(ui.serviceDate,-1);render();break;
      case 'service-next':if(ui.serviceDate<today())ui.serviceDate=plusDays(ui.serviceDate,1);render();break;
      case 'service-today':ui.serviceDate=today();render();break;
      case 'see-demo':ui.serviceDate='2026-11-04';render();break;
      case 'week-prev':ui.week=plusDays(ui.week,-7);ui.golemDate=ui.week;render();break;
      case 'week-next':ui.week=plusDays(ui.week,7);ui.golemDate=ui.week;render();break;
      case 'week-today':ui.week=golemWeekStart(today());ui.golemDate=today();render();break;
      case 'golem-toggle':toggleGolem(el);break;
      case 'golem-bulk':golemRegisterModal(el.dataset.party,el.dataset.date);break;
      case 'golem-select-all':document.querySelectorAll('#golem-register-form input[name="character"]').forEach(x=>x.checked=true);break;
      case 'golem-select-none':document.querySelectorAll('#golem-register-form input[name="character"]').forEach(x=>x.checked=false);break;
      case 'backup':backupModal();break;
      case 'close-modal':case 'outside':closeModal();break;
      case 'export':downloadBackup();break;
      case 'import':$('#backup-input').click();break;
      case 'reset':reset();break;
      case 'remove-demo':removeDemo();break;
      case 'logout':cloud.logout();break;
      case 'import-legacy':importLegacy();break;
    }
  });
  document.addEventListener('change',e=>{
    if(e.target.id==='c-start'){
      const sel=document.getElementById('c-shift'),w=dayOfWeek(e.target.value);
      if(sel&&w>=0){if(w===2)sel.value='morning';else if([0,5,6].includes(w))sel.value='night';}
    }
    if(e.target.id==='service-date'){
      if(fromKey(e.target.value)&&e.target.value<=today())ui.serviceDate=e.target.value;
      else toast('Escolha uma data válida até hoje.',true);
      render();
    }
    if(e.target.id==='register-golem-date'){
      if(fromKey(e.target.value)&&e.target.value<=today())updateGolemRoster(e.target.value);
      else toast('Data inválida.',true);
    }
    if(e.target.id==='golem-date'){
      if(fromKey(e.target.value)){ui.golemDate=e.target.value;ui.week=golemWeekStart(ui.golemDate);}
      else toast('Data inválida.',true);
      render();
    }
  });
  document.addEventListener('submit',e=>{
    if(e.target.id==='client-form'){e.preventDefault();saveClient(e.target);}
    if(e.target.id==='golem-register-form'){e.preventDefault();registerGolem(e.target);}
  });
  $('#backup-input').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      if(file.size>10*1024*1024)throw Error('O backup é muito grande (máximo 10 MB).');
      const json=JSON.parse(await file.text());
      const data=Array.isArray(json.sessions)&&!Array.isArray(json.logs)?migrateOld(json):json;
      if(!validate(data))throw Error('Arquivo incompatível. Selecione um backup válido.');
      if(confirm('Substituir os dados atuais NA NUVEM pelos registros do backup selecionado, para todos os dispositivos?')){
        state={...empty(),...data};deduplicateGolems();ui.clientId=state.clients[0]?.id||'';ui.tab='service';save();closeModal();render();toast('Backup recuperado com sucesso.');
      }
    }catch(err){toast(`Falha na importação: ${err.message}`,true);}
    e.target.value='';
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
  render();
};
