/* Direct Google Sheets API adapter. Google consent + spreadsheet sharing govern access.
 * Access tokens live in memory only. There is no public proxy or service-account key. */
(() => {
  const ID = '1I8HLPXRftPiVzR35NPCyU4d9T3SbThZGVjiiqKTvliI';
  const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
  let token = '', expiry = 0, writing = false;
  const quote = name => "'" + name.replaceAll("'", "''") + "'";
  const allowed = {
    '03 Tugasan': {columns:[7], statuses:['Belum mula','Dalam proses','Selesai','Perlu semak'], key:0},
    '08 Packing': {columns:[6,7,8], statuses:['Belum sedia','Sedia','Sudah pack','Tidak perlu'], key:1},
    '15 Dokumen Digital': {columns:[2,3,4], statuses:['Belum sedia','Sedia','Sudah pack','Tidak perlu'], key:0}
  };
  function authenticated() { return !!token && Date.now() < expiry; }
  async function api(path, options={}) {
    if (!authenticated()) throw Error('Sesi Google tamat. Sambung semula untuk meneruskan.');
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),20000);
    try {
      const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + ID + path, {...options, signal:controller.signal, headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...options.headers}});
      const result = await res.json();
      if (!res.ok) { if(res.status===401) {token='';expiry=0;} throw Error(result.error?.message || 'Google Sheets tidak dapat diakses.'); }
      return result;
    } catch(error) {if(error.name==='AbortError') throw Error('Sambungan mengambil terlalu lama. Semak Sheet sebelum cuba semula.');throw error;} finally{clearTimeout(timeout);}
  }
  async function connect(clientId) {
    if(!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw Error('Masukkan OAuth Client ID Google yang sah.');
    if(!window.google?.accounts?.oauth2) throw Error('Log masuk Google belum dimuatkan. Semak sambungan internet dan cuba semula.');
    await new Promise((resolve,reject)=>{
      const client=google.accounts.oauth2.initTokenClient({client_id:clientId,scope:SCOPE,callback:r=>{
        if(r.error) return reject(Error(r.error_description || r.error));
        if(!google.accounts.oauth2.hasGrantedAllScopes(r,SCOPE)) return reject(Error('Kebenaran Google Sheets diperlukan untuk sync.'));
        token=r.access_token;expiry=Date.now()+(Number(r.expires_in)-60)*1000;resolve();
      },error_callback:r=>reject(Error(r.type==='popup_closed'?'Tetingkap log masuk ditutup.':'Tetingkap log masuk disekat. Benarkan popup untuk laman ini.'))});
      client.requestAccessToken({prompt:''});
    });
  }
  async function read(template) {
    if(writing) throw Error('Tunggu perubahan selesai disimpan.');
    const q=template.sheets.map(s=>'ranges='+encodeURIComponent(quote(s.name)+'!A1:M')).join('&');
    const res=await api('/values:batchGet?'+q+'&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING');
    if(res.valueRanges?.length!==template.sheets.length) throw Error('Struktur Sheet berubah. Semak semua tab asal.');
    return {...template, liveAt:new Date().toISOString(), sheets:template.sheets.map((s,i)=>{
      const grid=res.valueRanges[i].values || [];
      return {...s,title:grid[0]?.[0] || s.title,note:grid[1]?.[0] || s.note,headers:(grid[4]||[]).map(String), rows:grid.slice(5).filter(r=>r.some(v=>String(v).trim())).map(r=>Array.from({length:13},(_,c)=>String(r[c]??''))), sourceRows:grid.slice(5).map((r,i)=>r.some(v=>String(v).trim())?i+6:null).filter(Boolean)};
    })};
  }
  async function update(sheet, index, column, value) {
    const rule=allowed[sheet.name];
    if(!rule || !rule.columns.includes(column) || !rule.statuses.includes(value)) throw Error('Sel ini tidak boleh diedit melalui checklist.');
    if(writing) throw Error('Satu perubahan masih sedang disimpan.');
    const row=sheet.sourceRows?.[index] ?? index+6;
    if(!Number.isInteger(row) || row<6) throw Error('Nombor baris tidak sah.');
    writing=true;
    try {
      const range=quote(sheet.name)+'!A'+row+':M'+row;
      const current=await api('/values/'+encodeURIComponent(range));
      const actual=current.values?.[0] || [];
      if(String(actual[rule.key]??'')!==sheet.rows[index][rule.key]) throw Error('Baris telah dipindahkan. Refresh dahulu sebelum menanda.');
      if(String(actual[column]??'')!==sheet.rows[index][column]) throw Error('Status telah diubah oleh rakan. Refresh untuk melihat status terbaru.');
      const cell=quote(sheet.name)+'!'+String.fromCharCode(65+column)+row;
      await api('/values/'+encodeURIComponent(cell)+'?valueInputOption=RAW',{method:'PUT',body:JSON.stringify({range:cell,majorDimension:'ROWS',values:[[value]]})});
      // Only report success after an independent read confirms the saved value.
      const check=await api('/values/'+encodeURIComponent(cell));
      if(check.values?.[0]?.[0]!==value) throw Error('Status belum dapat disahkan. Refresh dan semak sebelum cuba semula.');
      sheet.rows[index][column]=value;
      return {range:cell,at:new Date().toISOString()};
    } finally {writing=false;}
  }
  function disconnect(){token='';expiry=0;}
  window.ChengduSheets = {connect,read,update,disconnect,authenticated,get busy(){return writing;}};
})();
