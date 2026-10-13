/* Chengdu Apps Script adapter. The group access code stays in memory, never GitHub. */
(() => {
  let endpoint='', accessCode='', connected=false, writing=false;
  const allowed={
    '03 Tugasan':{columns:[7],statuses:['Belum mula','Dalam proses','Selesai','Perlu semak']},
    '08 Packing':{columns:[6,7,8],statuses:['Belum sedia','Sedia','Sudah pack','Tidak perlu']},
    '15 Dokumen Digital':{columns:[2,3,4],statuses:['Belum sedia','Sedia','Sudah pack','Tidak perlu']}
  };
  async function request(action,payload={}) {
    if(!endpoint||!accessCode) throw Error('Masukkan URL Web App dan kod akses kumpulan dahulu.');
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),45000);
    try {
      // text/plain is a CORS-safelisted content type. Avoid a preflight unsupported by Apps Script.
      // Never use mode:no-cors: an opaque response cannot confirm a successful save.
      const res=await fetch(endpoint,{method:'POST',mode:'cors',credentials:'omit',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,...payload,accessCode}),signal:controller.signal});
      if(!res.ok) throw Error('Web App tidak dapat diakses. Semak deployment: Execute as Me, Who has access Anyone.');
      let result;try{result=await res.json();}catch{throw Error('Google tidak memulangkan data planner. Gunakan URL /exec dan akses Anyone.');}
      if(!result.ok){if(result.code==='UNAUTHORIZED'){connected=false;accessCode='';}throw Error(result.message||'Permintaan tidak berjaya.');}
      return result.data;
    } catch(e) {
      if(e.name==='AbortError') throw Error('Sambungan tamat masa. Refresh dan semak Sheet sebelum cuba menulis semula.');
      if(e instanceof TypeError) throw Error('Sambungan Web App gagal. Semak internet, URL /exec dan deployment Anyone; jika baru deploy, cuba semula.');
      throw e;
    } finally {clearTimeout(timeout);}
  }
  async function connect(url,code) {
    if(!/^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(url)) throw Error('Gunakan URL Web App https://script.google.com/macros/s/…/exec.');
    if(!/^[a-f0-9]{64}$/i.test(code)) throw Error('Salin kod akses 64 aksara daripada setupChengdu.');
    endpoint=url;accessCode=code;connected=false;
    // Actual connection is confirmed only after a successful authenticated read.
  }
  async function read(template) {
    if(writing) throw Error('Tunggu perubahan selesai disimpan.');
    const result=await request('read');
    if(!Array.isArray(result?.sheets)||!template.sheets.every(s=>result.sheets.some(t=>t.name===s.name))) throw Error('Struktur Sheet tidak sepadan dengan planner 18 tab.');
    connected=true;
    return {...template,...result};
  }
  async function update(sheet,index,column,value) {
    if(!connected) throw Error('Sambungkan Sheet dahulu.');
    const rule=allowed[sheet.name],row=sheet.sourceRows?.[index];
    if(!rule||!rule.columns.includes(column)||!rule.statuses.includes(value)||!Number.isInteger(row)||row<6) throw Error('Sel status tidak sah. Refresh dahulu.');
    if(writing) throw Error('Satu perubahan masih sedang disimpan.');
    const original=sheet.rows[index];
    writing=true;
    try {
      const saved=await request('update',{sheet:sheet.name,row,column,value,expected:original[column],identity:JSON.stringify([String(original[0]||''),String(original[1]||'')]),requestId:crypto.randomUUID()});
      if(saved?.value!==value||saved?.row!==row||saved?.column!==column||saved?.sheet!==sheet.name) throw Error('Simpanan belum dapat disahkan. Refresh dan semak Sheet.');
      sheet.rows[index][column]=saved.value;
      return saved;
    } finally {writing=false;}
  }
  function disconnect(){accessCode='';endpoint='';connected=false;}
  window.ChengduSheets={connect,read,update,disconnect,authenticated:()=>connected,get busy(){return writing;}};
})();
