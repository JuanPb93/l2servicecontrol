/* Dethrone Control v1.4 — login com PIN, sincronização segura via Edge Function.
 * PINs e chave service_role NUNCA ficam neste JavaScript.
 */
(() => {
  'use strict';
  const config = window.DETHRONE_CONFIG || {};
  const SESSION_KEY = 'dethrone-v14-session';
  const PENDING_KEY = 'dethrone-v14-pending';
  const LOCAL_OLD_KEY = 'dethrone-control-v11';
  const LOCAL_V10_KEY = 'dethrone-command-v1';
  const $ = selector => document.querySelector(selector);
  const clone = object => JSON.parse(JSON.stringify(object));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const empty = () => ({version:3,demo:false,migrated:false,clients:[],logs:[],golems:[],legacyBosses:[],legacyParties:[]});
  const apiUrl = String(config.supabaseUrl || '').replace(/\/$/, '') + '/functions/v1/dethrone-api';
  const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(String(config.supabaseUrl || '')) || /^http:\/\/localhost:54321\/?$/i.test(String(config.supabaseUrl || ''));
  let session = sessionStorage.getItem(SESSION_KEY) || '';
  let revision = 0;
  let base = empty();
  let draft = null;
  let inFlight = false;
  let blocked = false;
  let flushTimer;
  let appIsStarted = false;
  let refreshTimer;
  let applyToApp = null;
  let loginButton = null;

  async function api(action, other = {}) {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 18000);
    try {
      const response = await fetch(apiUrl, {
        method: 'POST', mode: 'cors', cache: 'no-store', signal: abort.signal,
        headers: { 'Content-Type':'application/json', ...(action === 'login' ? {} : { 'Authorization':`Bearer ${session}` }) },
        body: JSON.stringify({ action, ...other }),
      });
      let data = {};
      try { data = await response.json(); } catch { /* We will show the HTTP status */ }
      if (response.status === 409 && data.conflict) return data;
      if (!response.ok || !data.ok) {
        const err = new Error(data.error || `Erro HTTP ${response.status}.`);
        err.status = response.status;
        throw err;
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('A conexão com o Supabase expirou. Tente novamente.');
      throw err;
    } finally { clearTimeout(timeout); }
  }
  function status(message, kind = 'ok') {
    const pill = $('#cloud-status');
    if (!pill) return;
    pill.className = `saved-pill cloud-status ${kind}`;
    pill.innerHTML = '<span class="saved-dot"></span>';
    pill.append(document.createTextNode(' ' + message));
    const mobile=$('#cloud-mobile-status');
    if(mobile){mobile.className=`mobile-cloud-status ${kind}`;mobile.textContent='● ' + message;}
  }
  function notice(message, actions = []) {
    const el = $('#cloud-notice');
    if (!el) return;
    el.replaceChildren();
    if (!message) { el.hidden = true; return; }
    el.hidden = false;
    const p = document.createElement('p'); p.textContent = message;
    el.append(p);
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'btn btn-small secondary'; b.type = 'button'; b.textContent = a.text;
      b.addEventListener('click', a.onClick);
      el.append(b);
    }
  }
  function getPending() {
    try { const value = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); return value && Array.isArray(value.local?.clients) ? value : null; }
    catch { return null; }
  }
  function savePending() {
    if (!draft) { localStorage.removeItem(PENDING_KEY); return; }
    try { localStorage.setItem(PENDING_KEY, JSON.stringify({base, local:draft, when:new Date().toISOString()})); }
    catch { status('Sem espaço para backup local', 'error'); notice('Armazenamento do navegador cheio. Exporte um backup JSON agora.'); }
  }
  function mapBy(array, keyer) {
    const map = new Map();
    for (const item of array || []) map.set(keyer(item), item);
    return map;
  }
  function mergedArray(start, ours, theirs, keyer, label, conflicts) {
    const a = mapBy(start, keyer), b = mapBy(ours, keyer), c = mapBy(theirs, keyer);
    const keys = new Set([...a.keys(), ...b.keys(), ...c.keys()]);
    for (const key of keys) {
      const old = a.get(key), mine = b.get(key), remote = c.get(key);
      const mineChanged = !equal(mine, old);
      const remoteChanged = !equal(remote, old);
      if (mineChanged && remoteChanged && !equal(mine,remote)) {
        conflicts.push(`${label}: ${key}`);
      } else if (mineChanged) {
        if (mine === undefined) c.delete(key); else c.set(key, mine);
      }
    }
    return [...c.values()];
  }
  function merge(start, ours, theirs) {
    const conflicts=[];
    const result = { ...clone(theirs), version:3 };
    const specs = [
      ['clients', c=>String(c.id), 'Service'],
      ['logs', l=>`${l.clientId}/${l.charId}/${l.date}/${l.shift}`, 'Dethrone'],
      ['golems', g=>`${g.partyId}/${g.character}/${g.date}`, 'Golem'],
    ];
    for (const [field, keyer, label] of specs) {
      result[field] = mergedArray(start[field], ours[field], theirs[field], keyer, label, conflicts);
    }
    for (const field of ['legacyBosses','legacyParties']) {
      const previous = start[field] || [], mine = ours[field] || [], remote = theirs[field] || [];
      if (!equal(mine,previous)) {
        if (!equal(remote,previous) && !equal(remote,mine)) conflicts.push(`Histórico: ${field}`);
        else result[field]=mine;
      }
    }
    result.demo = result.clients.some(c => c.demo);
    result.migrated = Boolean(theirs.migrated || ours.migrated);
    // Uma exclusão de service também remove as horas correspondentes.
    const ids=new Set(result.clients.map(c=>c.id));
    result.logs=result.logs.filter(l=>ids.has(l.clientId));
    return { result, conflicts };
  }
  function conflictActions() {
    notice('Dois dispositivos modificaram o mesmo registro. Nenhum dado foi descartado: suas alterações continuam guardadas neste navegador. Faça um backup antes de escolher uma versão.', [
      { text:'Baixar backup local',onClick:()=>window.DethroneApp?.exportBackup?.() },
      { text:'Usar versão da nuvem',onClick:loadCloudInstead },
      { text:'Substituir versão da nuvem',onClick:overwriteCloud },
    ]);
  }
  async function loadCloudInstead() {
    if (!confirm('Descartar as alterações ainda não sincronizadas deste dispositivo e carregar os dados da nuvem? Recomendamos baixar um backup antes.')) return;
    try {
      const data=await api('load');
      base=clone(data.payload || empty());revision=Number(data.revision)||0;
      draft=null; blocked=false; savePending();
      applyToApp?.(clone(base)); status('Salvo na nuvem');notice('');
    }catch(e){notice(e.message);}
  }
  async function overwriteCloud() {
    if (!draft || !confirm('ATENÇÃO: isso irá substituir os registros mais recentes de outros dispositivos. Quer continuar?')) return;
    if (!confirm('Confirma novamente que deseja sobrescrever os dados da nuvem?')) return;
    try {
      const remote=await api('load');
      revision=Number(remote.revision)||0;
      base=clone(remote.payload||empty());
      blocked=false;savePending();notice('');
      flushSoon(0);
    } catch(e) { notice(e.message); }
  }
  function flushSoon(delay = 550) {
    clearTimeout(flushTimer);
    if (blocked || inFlight || !session || !draft) return;
    flushTimer = setTimeout(flush, delay);
  }
  async function flush() {
    if (blocked || inFlight || !session || !draft) return;
    inFlight = true;
    const outgoing=clone(draft);
    draft = null;
    let lastAttemptFailed = false;
    status('Sincronizando…', 'working');
    try {
      const saved = await api('save', {payload:outgoing,revision});
      if (saved.conflict) {
        const remote = await api('load');
        const pending = draft || outgoing;
        const combined = merge(base, pending, remote.payload || empty());
        if (combined.conflicts.length) {
          draft=clone(pending);blocked=true;
          savePending();status('Conflito entre dispositivos', 'error');conflictActions();
        } else {
          revision=Number(remote.revision)||0;
          base=clone(remote.payload||empty());
          draft=combined.result;savePending();
          applyToApp?.(clone(combined.result));
          status('Atualizando registros…', 'working');
        }
      } else {
        revision=Number(saved.revision);
        base=clone(outgoing);
        savePending();
        if (!draft) { status('Salvo na nuvem');notice(''); }
      }
    } catch (err) {
      lastAttemptFailed = true;
      if (!draft) draft=outgoing;
      savePending();status('Pendente de sincronização', 'error');
      if (err.status===401) {
        notice('O acesso expirou. Seus dados estão guardados neste navegador. Entre com o PIN novamente para sincronizar.');
        sessionStorage.removeItem(SESSION_KEY);session='';
        setTimeout(()=>location.reload(),900);
      } else {
        notice('Sem conexão com o Supabase. O registro foi mantido neste navegador e será reenviado quando a conexão voltar.');
      }
    } finally {
      inFlight=false;
      if (draft && !blocked && session) flushSoon(lastAttemptFailed ? 15000 : 1200);
    }
  }
  function push(value) {
    draft=clone(value);
    savePending();
    status('Aguardando sincronização…', 'working');
    flushSoon();
  }
  async function refresh() {
    if (!session || draft || inFlight || blocked || !appIsStarted || $('#client-form') || $('#golem-register-form')) return;
    try {
      const remote=await api('load');
      if (Number(remote.revision) !== revision) {
        revision=Number(remote.revision)||0;
        base=clone(remote.payload||empty());
        applyToApp?.(clone(base));
        status('Atualizado da nuvem');
      }
    } catch (err) {
      if (err.status===401) {
        session='';sessionStorage.removeItem(SESSION_KEY);
        notice('Sua sessão expirou. Faça login novamente.');
        setTimeout(()=>location.reload(),900);
      } else status('Sem conexão — dados mantidos', 'error');
    }
  }
  function hasLegacy() {
    try {
      const stored = localStorage.getItem(LOCAL_OLD_KEY) || localStorage.getItem(LOCAL_V10_KEY);
      const parsed = stored && JSON.parse(stored);
      return !!parsed && Array.isArray(parsed.clients) && (parsed.clients.length > 0 || parsed.golems?.length > 0 || parsed.sessions?.length > 0);
    } catch {return false;}
  }
  function legacyJson() {
    const text=localStorage.getItem(LOCAL_OLD_KEY) || localStorage.getItem(LOCAL_V10_KEY);
    return text ? JSON.parse(text) : null;
  }
  function reveal() {
    $('#auth-root').hidden=true;
    $('#secured-app').hidden=false;
  }
  function showGate(message='', isSetup=false) {
    $('#secured-app').hidden=true;
    const root=$('#auth-root');root.hidden=false;
    root.innerHTML=`<div class="gate-page"><div class="gate-card">
      <div class="gate-logo">✦</div><div class="eyebrow">DETHRONE CONTROL <span style="color:#edb96b">v1.4</span></div>
      <h1>${isSetup?'Conectar ao Supabase':'Acesso privado'}</h1>
      <p>${isSetup?'A URL do projeto Supabase ainda não foi configurada em <code>js/config.js</code>. Veja o README do ZIP para concluir a instalação.':'Digite um dos seus três PINs para abrir o painel compartilhado.'}</p>
      ${isSetup?'<div class="notice">Não coloque os PINs no GitHub. Configure-os como Secrets da Edge Function.</div>':
        `<form id="pin-form"><label for="pin-input">PIN de 6 dígitos</label><input id="pin-input" name="pin" type="password" autocomplete="off" inputmode="numeric" maxlength="6" minlength="6" pattern="[0-9]{6}" placeholder="••••••" required>
        <button class="btn primary" type="submit" id="pin-button">Entrar no controle</button></form>`}
      <div class="gate-message" role="alert">${message.replace(/[<>&]/g,'')}</div>
      <small>Services e Chaos Golem • Todos os PINs acessam os mesmos registros</small>
    </div></div>`;
    if (!isSetup) {
      const form = $('#pin-form');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const pin=$('#pin-input').value;
        if(!/^\d{6}$/.test(pin))return;
        const button=$('#pin-button');button.disabled=true;button.textContent='Verificando…';
        try{
          const auth=await api('login',{pin});
          session=auth.token;sessionStorage.setItem(SESSION_KEY,session);
          $('#pin-input').value='';
          await unlock();
        }catch(err){showGate(err.message);} 
      });
      $('#pin-input')?.focus();
    }
  }
  async function unlock() {
    const remote=await api('load');
    revision=Number(remote.revision)||0;
    base=clone(remote.payload||empty());
    let initial=clone(base);
    const preserved=getPending();
    if (preserved) {
      const combined=merge(preserved.base||empty(),preserved.local,base);
      if (combined.conflicts.length) {
        draft=clone(preserved.local);initial=clone(draft);blocked=true;
      } else {
        draft=clone(combined.result);initial=clone(draft);
      }
    }
    reveal();
    status(draft ? 'Recuperando alterações…' : 'Salvo na nuvem', draft?'working':'ok');
    if (!appIsStarted) {
      window.DethroneStart(initial, {push, hasLegacy, legacyJson, onRemote:fn=>applyToApp=fn});
      appIsStarted=true;
    } else applyToApp?.(initial);
    if (blocked) {status('Conflito entre dispositivos', 'error');conflictActions();}
    else if (draft) {savePending();flushSoon(100);}
    else if (revision===0 && hasLegacy()) {
      notice('Encontrei registros da v1.3 salvos neste navegador. Importe-os para a nuvem para não perder o histórico.',[
        {text:'Importar registros antigos',onClick:()=>window.DethroneApp?.importLegacy?.()},
        {text:'Não importar agora',onClick:()=>notice('')},
      ]);
    }
    clearInterval(refreshTimer);
    refreshTimer=setInterval(refresh,20000);
  }
  function logout() {
    if (draft && !confirm('Existem alterações ainda não sincronizadas. Elas ficarão neste navegador, mas não estarão na nuvem até você entrar novamente. Sair?'))return;
    sessionStorage.removeItem(SESSION_KEY);session='';location.reload();
  }
  window.DethroneCloud={ push, hasLegacy, legacyJson, logout, status, notice, onRemote:fn=>applyToApp=fn };
  async function boot() {
    if (!configured) {showGate('',true);return;}
    if (session) {
      try { await unlock();return; }
      catch(err) {sessionStorage.removeItem(SESSION_KEY);session='';showGate(err.status===401?'Sua sessão expirou. Digite o PIN novamente.':err.message);return;}
    }
    showGate();
  }
  window.addEventListener('online',()=>{if(draft&&!blocked)flushSoon(100);else refresh();});
  document.addEventListener('DOMContentLoaded',boot);
})();
