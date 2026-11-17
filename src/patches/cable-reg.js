/* ---------- 케이블: '등록 및 관리' 탭 안의 하위 메뉴 (케이블 등록 · 엑셀 일괄 등록 · 등록 케이블 관리) ---------- */
function cabSubTabs(app){
  const cur=cabDraft&&!cabDraft.isNew?'list':(route.s||'list');
  const subs=[['new','케이블 등록'],['xls','엑셀 일괄 등록'],['list','등록 케이블 관리 ('+visCables().length+')']];
  app.append(h('div',{class:'ctabs csub'},...subs.map(([k,l])=>h('button',{class:cur===k?'on':'',onclick:()=>{stopCam();cabDraft=null;cabSel=null;route={v:'cables',t:'reg',s:k};render();}},l))));
}
