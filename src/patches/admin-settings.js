/* ---------- 통합관리자 설정: 고객사 → 사이트 → 서버 운영방식 → 점검업체·점검자 ----------
   scripts/split-artifact.mjs 가 이 파일을 public/app.js 끝에 붙이고, vSettings 의 관리자 분기를 adminSettings 로 돌립니다.
   고객사 문서(clients)에 저장하는 필드: deploy('cloud'|'onprem'), ownerId(담당 점검업체), personIds(담당 점검자 id 목록) */
const DEPLOY_OPTS=[['cloud','클라우드 (구독형)','이 서비스 서버에서 운영합니다. 고객사는 구독해서 접속합니다.'],
  ['onprem','설치형 (고객사 서버)','고객사 서버에 따로 설치해 운영합니다. 그 고객사와 담당 점검업체 정보만 다룹니다.']];
const numT=(i,n)=>(i+1)+'. '+(((n||'').trim())||'(이름 입력 전)');
const deployLabel=v=>((DEPLOY_OPTS.find(o=>o[0]===v)||DEPLOY_OPTS[0])[1]);
function adminSettings(app){
  const wr=(col,r)=>{const {id,...b}=r;b.updatedAt=new Date().toISOString();setSave('저장 중…');return db.collection(col).doc(id).set(b).then(()=>setSave('저장됨 '+hhmm())).catch(e=>setSave('저장 실패: '+(e.code||e.message)));};
  const deb=(col,r)=>{let t;return()=>{clearTimeout(t);setSave('저장 대기…');t=setTimeout(()=>wr(col,r),600);};};
  const secH=(n,t,sub)=>h('div',{class:'ksec-h'},h('span',{class:'ksec-n'},n),h('b',{},t),sub?h('span',{class:'muted sm'},sub):null);
  if(deployOn()){const k=raw.clients.find(x=>x.id===DEPLOY.clientId)||{};
    app.append(h('div',{class:'card note'},h('div',{class:'row sb'},h('div',{},h('b',{},'설치형 화면으로 보는 중 · '+(k.name||'')),h('div',{class:'muted sm'},'이 고객사와 담당 점검업체 정보만 보입니다.')),
      h('button',{class:'pri',onclick:()=>setDeploy({mode:'cloud',clientId:''})},'전체 보기로 돌아가기'))));}
  app.append(h('div',{class:'muted',id:'savestate',style:'margin:0 4px 10px'},'변경 내용은 자동 저장됩니다.'));

  /* 고객사 */
  const kc=h('div',{class:'card'},h('div',{class:'row sb'},h('h3',{style:'margin:0'},'고객사 ('+clients.length+')'),
      h('button',{class:'pri',onclick:()=>wr('clients',openNew({id:uid(),name:'',biz:'',mgr:'',tel:'',addr:'',deploy:'cloud',ownerId:'',personIds:[]}))},'+ 고객사 추가')),
    h('div',{class:'muted',style:'margin-top:6px'},'고객사를 펼쳐 ① 고객사 정보 → ② 사이트 → ③ 서버 운영방식 → ④ 점검업체·점검자 순서로 입력하세요.'));
  if(!clients.length)kc.append(h('div',{class:'muted',style:'margin-top:10px'},'등록된 고객사가 없습니다. 고객사를 추가하세요.'));
  clients.slice().sort(byName).forEach((k,ki)=>{
    const sv0=deb('clients',k);let F;const sv=()=>{sv0();F&&F.upd();};
    const kSites=()=>sites.filter(x=>x.clientId===k.id).sort((a,b)=>(a.name||'').localeCompare(b.name||'','ko'));
    const kPeople=()=>(k.personIds||[]).map(id=>people.find(p=>p.id===id)).filter(p=>p&&p.companyId===k.ownerId);

    // ① 고객사 정보
    const s1=h('div',{class:'ksec'},secH('1','고객사 정보'),
      h('div',{class:'item'},fld('고객사명(발주처)',bind(k,'name',{on:sv,ph:'예: 한빛자산관리'}),2),fld('사업자등록번호',bind(k,'biz',{on:sv})),
        fld('담당자',bind(k,'mgr',{on:sv})),fld('연락처',bind(k,'tel',{on:sv})),fld('주소',bind(k,'addr',{on:sv}),2),
        acctBlock('client',k,'client')));

    // ② 사이트
    const ss=kSites();
    const s2=h('div',{class:'ksec'},secH('2','사이트','고객사 건물 · '+ss.length+'곳'));
    if(!ss.length)s2.append(h('div',{class:'muted sm',style:'margin:4px 0'},'등록된 사이트가 없습니다.'));
    ss.forEach(s=>s2.append(h('div',{class:'ksite',onclick:()=>go('siteview',{id:s.id})},
      h('div',{class:'grow'},h('b',{},s.name||'(이름 없음)'),h('div',{class:'muted sm'},[s.address,s.mgr&&('관리 '+s.mgr)].filter(Boolean).join(' · ')||'주소 미입력')),
      h('span',{class:'pill'},'위치 '+locsOfSite(s.id).length),h('span',{class:'fold-i'},'›'))));
    s2.append(h('button',{class:'mini',style:'margin-top:8px',onclick:()=>{if(!(k.name||'').trim()){alert2('고객사명을 먼저 입력하세요.');return;}
      siteDraft={id:uid(),isNew:true,name:'',client:k.name,clientId:k.id,ownerId:k.ownerId||'',address:k.addr||'',completed:'',area:'',mgr:k.mgr||'',mgrTel:k.tel||'',areas:[],fac:{}};go('siteedit');}},'+ 사이트 추가'));

    // ③ 서버 운영방식
    if(!k.deploy)k.deploy='cloud';
    const opts=h('div',{class:'kopts'});
    const drawOpts=()=>opts.replaceChildren(...DEPLOY_OPTS.map(([v,l,d])=>h('label',{class:'kopt'+(k.deploy===v?' on':'')},
      h('input',{type:'radio',name:'dep-'+k.id,value:v,checked:k.deploy===v,onchange:()=>{k.deploy=v;drawOpts();drawView();sv();}}),
      h('div',{},h('b',{},l),h('div',{class:'muted sm'},d)))));
    const view=h('div',{style:'margin-top:8px'});
    const drawView=()=>view.replaceChildren(k.deploy==='onprem'?h('button',{class:'mini',onclick:()=>setDeploy({mode:'onprem',clientId:k.id})},'이 고객사 설치형 화면으로 보기'):'');
    drawOpts();drawView();
    const s3=h('div',{class:'ksec'},secH('3','서버 운영방식'),opts,view);

    // ④ 점검업체·점검자
    const plist=h('div',{class:'kpeople'});
    const drawPeople=()=>{const ps=people.filter(p=>p.companyId===k.ownerId).sort(byName);
      if(!k.ownerId){plist.replaceChildren(h('div',{class:'muted sm'},'점검업체를 먼저 고르세요.'));return;}
      if(!ps.length){plist.replaceChildren(h('div',{class:'muted sm'},'이 업체에 등록된 점검자가 없습니다. 아래 점검자 목록에서 추가하세요.'));return;}
      plist.replaceChildren(...ps.map(p=>h('label',{class:'kchk'},h('input',{type:'checkbox',checked:(k.personIds||[]).includes(p.id),onchange:e=>{
        const set=new Set(k.personIds||[]);e.target.checked?set.add(p.id):set.delete(p.id);k.personIds=[...set];sv();}}),
        h('span',{},p.name||'(이름 없음)'),p.grade?h('span',{class:'muted sm'},gradeLabel(p.grade)):null)));};
    const coSel=selBox(k,'ownerId',companies.slice().sort(byName).map(c=>[c.id,c.name||'(이름 없음)']),'점검업체 선택',()=>{
      const ok=new Set(people.filter(p=>p.companyId===k.ownerId).map(p=>p.id));k.personIds=(k.personIds||[]).filter(id=>ok.has(id));
      kSites().filter(s=>(s.ownerId||'')!==(k.ownerId||'')).forEach(s=>{s.ownerId=k.ownerId||'';wr('sites',s);}); // 사이트 담당 업체도 함께 맞춤 (점검업체 계정의 열람 범위)
      drawPeople();sv();});
    drawPeople();
    const s4=h('div',{class:'ksec'},secH('4','점검업체·점검자','이 고객사를 맡을 업체와 사람'),
      h('div',{class:'item'},fld('담당 점검업체',coSel,2)),
      h('label',{class:'f',style:'margin-top:10px;display:block'},'담당 점검자'),plist,
      h('div',{class:'muted sm',style:'margin-top:6px'},'업체를 바꾸면 이 고객사의 모든 사이트 담당 업체도 같이 바뀝니다. 업체·점검자는 아래 목록에서 먼저 등록하세요.'));

    const del=h('div',{style:'margin-top:12px;display:flex;justify-content:flex-end'},twoStep('고객사 삭제',()=>{
      if(raw.sites.some(x=>x.clientId===k.id)){alert2('이 고객사에 연결된 사이트가 있어 삭제할 수 없습니다.');return;}
      dropAccts('client',k.id);db.collection('clients').doc(k.id).delete();}));
    const B=h('div',{},s1,s2,s3,s4,del);
    F=foldItem(k.id,'k-'+k.id,()=>numT(ki,k.name),()=>[k.mgr,k.tel].filter(Boolean).join(' · ')||'담당자 미입력',
      ()=>[deployLabel(k.deploy).replace(/ \(.*\)/,''),(companies.find(c=>c.id===k.ownerId)||{}).name,'사이트 '+kSites().length,kPeople().length?'점검자 '+kPeople().length:''].filter(Boolean),B);
    kc.append(F);});
  // 고객사가 지정되지 않은 사이트
  const lone=sites.filter(s=>!clients.some(k=>k.id===s.clientId));
  if(lone.length){kc.append(h('div',{class:'ksec',style:'margin-top:14px'},secH('!','고객사 미지정 사이트','사이트를 열어 고객사를 지정하세요'),
    ...lone.map(s=>h('div',{class:'ksite',onclick:()=>go('siteview',{id:s.id})},h('div',{class:'grow'},h('b',{},s.name||'(이름 없음)'),h('div',{class:'muted sm'},s.client||'')),h('span',{class:'fold-i'},'›')))));}
  app.append(kc);

  /* 기초 자료: 점검업체 · 점검자 · 위치 · 엑셀 */
  app.append(h('h3',{style:'margin:18px 6px 8px'},'기초 자료'));
  const cc=h('div',{class:'card'},h('div',{class:'row sb'},h('h3',{style:'margin:0'},'점검업체 ('+companies.length+')'),h('button',{class:'pri',onclick:()=>wr('companies',openNew({id:uid(),name:'',biz:'',tel:''}))},'+ 업체 추가')));
  if(!companies.length)cc.append(h('div',{class:'muted',style:'margin-top:10px'},'등록된 업체가 없습니다. 업체를 먼저 추가하세요.'));
  companies.slice().sort(byName).forEach((c,ci)=>{const sv0=deb('companies',c);let F;const sv=()=>{sv0();F&&F.upd();};
    const B=(h('div',{class:'item'},fld('업체명',bind(c,'name',{on:sv,ph:'예: 제이솔루션'}),2),fld('사업자등록번호',bind(c,'biz',{on:sv})),fld('연락처',bind(c,'tel',{on:sv})),
      twoStep('삭제',()=>{if(people.some(p=>p.companyId===c.id)){alert2('소속 점검자를 먼저 삭제하거나 다른 업체로 옮기세요.');return;}db.collection('companies').doc(c.id).delete();})));
    F=foldItem(c.id,'co-'+c.id,()=>numT(ci,c.name),()=>c.tel||'연락처 미입력',()=>['고객사 '+clients.filter(k=>k.ownerId===c.id).length,'점검자 '+people.filter(p=>p.companyId===c.id).length],B);cc.append(F);});
  app.append(cc);
  const pc=h('div',{class:'card'},h('div',{class:'row sb'},h('h3',{style:'margin:0'},'점검자 ('+people.length+')'),h('button',{class:'pri',disabled:!companies.length,onclick:()=>wr('people',openNew({id:uid(),name:'',companyId:'',grade:'특급',tel:''}))},'+ 점검자 추가')));
  if(!people.length)pc.append(h('div',{class:'muted',style:'margin-top:10px'},companies.length?'등록된 점검자가 없습니다.':'점검업체를 먼저 등록하세요.'));
  people.slice().sort(byName).forEach((p,pi)=>{const sv0=deb('people',p);let F;const sv=()=>{sv0();F&&F.upd();};
    const B=(h('div',{class:'item'},fld('성명',bind(p,'name',{on:sv}),2),fld('소속 업체',selBox(p,'companyId',companies.slice().sort(byName).map(c=>[c.id,c.name||'(이름 없음)']),'업체 선택',sv),2),
      fld('등급',selBox(p,'grade',GRADES,'등급 선택',sv),2),fld('연락처',bind(p,'tel',{on:sv})),
      acctBlock('person',p,'engineer'),
      twoStep('삭제',()=>{dropAccts('person',p.id);db.collection('people').doc(p.id).delete();})));
    F=foldItem(p.id,'pe-'+p.id,()=>numT(pi,p.name),()=>[(companies.find(c=>c.id===p.companyId)||{}).name,p.tel].filter(Boolean).join(' · ')||'소속 미지정',
      ()=>[p.grade,...clients.filter(k=>(k.personIds||[]).includes(p.id)).map(k=>k.name)].filter(Boolean),B);pc.append(F);});
  app.append(pc);
  app.append(locCard());
  app.append(excelCard());
  app.append(memoManager('*','공통 메모','모든 점검자의 메모 칸에 점선 칩으로 나옵니다. (각자의 내 메모가 먼저 나옵니다.)'));
}
