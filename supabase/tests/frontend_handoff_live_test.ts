// Isolated metadata fixtures only. Never switches mode or calls the chain.
const root = Deno.env.get('TEST_SUPABASE_URL')!;
const anon = Deno.env.get('TEST_SUPABASE_ANON_KEY')!;
const management = Deno.env.get('TEST_SUPABASE_ACCESS_TOKEN')!;
const accounts: {role:string;email:string;password:string}[] = JSON.parse(Deno.env.get('TEST_USERS_JSON')!);
const base = `${root}/functions/v1/civicproof-api`;
const project=crypto.randomUUID(), milestone=crypto.randomUUID(), invoice=crypto.randomUUID();
const sessions: Record<string,{token:string;id:string}> = {};
const headers=(role?:string)=>({apikey:anon,...(role?{Authorization:`Bearer ${sessions[role].token}`}:{})});
function assert(ok:unknown, message:string):asserts ok {if(!ok)throw new Error(message);}
async function sql(query:string) {
  const r=await fetch('https://api.supabase.com/v1/projects/crshjvjrgnnypxbpjmob/database/query',{method:'POST',headers:{Authorization:`Bearer ${management}`,'Content-Type':'application/json'},body:JSON.stringify({query})});
  const result=await r.json(); assert(r.ok,'Fixture query failed');return result;
}
async function api(path:string,role?:string,body?:unknown,expected=200) {
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...headers(role),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await r.json();assert(r.status===expected,`${path}: expected ${expected}, got ${r.status}`);return result.data;
}
Deno.test({name:'P1 live handoff: milestones, supplier IDs, status lists, delivery answers and safe names',sanitizeResources:false,sanitizeOps:false,fn:async()=>{
  try {
    for(const account of accounts) {
      const r=await fetch(`${root}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:JSON.stringify({email:account.email,password:account.password})});
      const s=await r.json(); assert(r.ok && s.access_token,`${account.role} sign-in`);sessions[account.role]={token:s.access_token,id:s.user.id};
    }
    const supplierMe=await api('/me','supplier');
    assert(supplierMe.suppliers.length===3 && supplierMe.supplier_ids.length===3,'Three owned demo suppliers');
    const supplier=supplierMe.supplier_ids[0];assert(/^[0-9a-f-]{36}$/.test(supplier),'Valid owned supplier UUID');
    await sql(`begin;
      insert into public.projects(id,code,name,budget_cents,permitted_categories,created_by) values('${project}','VERIFY-${project}','Temporary P1 metadata test',10000,array['water_storage'],'${sessions.municipality.id}');
      insert into public.milestones(id,project_id,code,title) values('${milestone}','${project}','M1','Temporary P1 milestone');
      insert into public.invoices(id,project_id,supplier_id,submitted_by,invoice_number,invoice_date,total_cents,document_path,document_sha256,ledger_mode)
        values('${invoice}','${project}','${supplier}','${sessions.supplier.id}','VERIFY-${invoice}','2026-11-20',100,'${sessions.supplier.id}/${invoice}.pdf','${'a'.repeat(64)}','simulated');
      update public.invoices set status='analysed' where id='${invoice}';
      insert into public.approvals(invoice_id,actor_id,decision,reason) values('${invoice}','${sessions.municipality.id}','hold','Temporary P1 test decision');
      update public.invoices set status='on_hold' where id='${invoice}';
      commit;`);
    const detail=await api(`/projects/${project}`);
    assert(detail.milestones.length===1 && detail.milestones[0].id===milestone,'Project embeds its own milestones');
    assert(Object.keys(detail.milestones[0]).sort().join(',')==='code,description,id,status,title,verified_at','Milestones expose requested public fields only');
    const municipality=await api('/me','municipality');
    for(const role of ['supplier','municipality','auditor']) {
      const d=await api(`/invoices/${invoice}`,role);
      assert(d.approvals[0].actor_display_name===municipality.display_name,'Approver display name for authorised invoice readers');
      assert(!JSON.stringify(d.approvals).includes('email'),'Approvals do not expose emails');
      const filtered=await api(`/invoices?project_id=${project}&status=submitted,analysed,on_hold,approved,payment_failed`,role);
      assert(filtered.length===1 && filtered[0].id===invoice,'Status list includes matching fixture');
      assert((await api(`/invoices?project_id=${project}&status=paid,rejected`,role)).length===0,'Status list excludes nonmatching fixture');
    }
    await api(`/invoices/${invoice}`,'citizen',undefined,404);
    await api(`/milestones/${milestone}/confirm`,'supplier',{answer:'yes'},403);
    await api(`/milestones/${milestone}/confirm`,'citizen',{answer:'maybe'},400);
    for(const answer of ['yes','no','not_sure',null]) {
      const body=answer===null?{note:'Legacy note only'}:{answer,note:'Temporary community evidence'};
      const rows=await api(`/milestones/${milestone}/confirm`,'citizen',body,201);
      assert(rows[0].answer===answer,'Answer persisted, including legacy null');
      const saved=await fetch(`${root}/rest/v1/verifications?id=eq.${rows[0].id}&select=answer,note,kind`,{headers:headers('citizen')});
      const savedRows=await saved.json();assert(saved.ok && savedRows[0].answer===answer,'Answer readable through RLS');
      assert((await api(`/projects/${project}`)).milestones[0].status==='pending','Community evidence does not verify delivery');
      await sql(`delete from public.verifications where id='${rows[0].id}' and milestone_id='${milestone}' and actor_id='${sessions.citizen.id}';`);
    }
    console.log('PASS live milestone shape, supplier ownership, list filters, approver names, answer round trips and access denial; no chain call made');
  } finally {
    await sql(`begin;
      delete from public.verifications where milestone_id='${milestone}';
      delete from public.approvals where invoice_id='${invoice}';
      delete from public.invoices where id='${invoice}';
      delete from public.milestones where id='${milestone}';
      delete from public.projects where id='${project}';commit;`);
    for(const role of Object.keys(sessions)) {const r=await fetch(`${root}/auth/v1/logout?scope=local`,{method:'POST',headers:headers(role)});await r.arrayBuffer();}
  }
}});
