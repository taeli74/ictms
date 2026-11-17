// 아티팩트 단일 HTML(artifact/source.html)을 배포용 파일로 나눕니다.
//   public/app.css, public/fonts/Paperlogy.woff2, public/app.js, index.html
// 아티팩트를 고친 뒤 새 HTML을 artifact/source.html 에 덮어쓰고 `npm run split` 하면 다시 만들어집니다.
// 패치가 맞지 않으면(원본 코드가 바뀌어서) 어느 패치인지 알려 주고 멈춥니다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'artifact/source.html'), 'utf8');

const between = (s, a, b, from = 0) => {
  const i = s.indexOf(a, from);
  if (i < 0) throw new Error('찾을 수 없음: ' + a.slice(0, 60));
  const j = s.indexOf(b, i + a.length);
  if (j < 0) throw new Error('찾을 수 없음: ' + b.slice(0, 60));
  return { body: s.slice(i + a.length, j), end: j + b.length };
};

// 1) CSS + 폰트
const style = between(src, '<style>', '</style>');
let css = style.body;
const fontRe = /url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/;
const fm = css.match(fontRe);
if (!fm) throw new Error('내장 폰트를 찾지 못했습니다.');
mkdirSync(join(root, 'public/fonts'), { recursive: true });
writeFileSync(join(root, 'public/fonts/Paperlogy.woff2'), Buffer.from(fm[1], 'base64'));
css = css.replace(fontRe, 'url(/fonts/Paperlogy.woff2)');
const overrides = readFileSync(join(root, 'src/overrides.css'), 'utf8');
writeFileSync(join(root, 'public/app.css'), css.trim() + '\n\n' + overrides);

// 2) 본문 마크업 (body 시작 ~ 첫 외부 스크립트 전)
const bodyStart = src.indexOf('<body>') + '<body>'.length;
const firstScript = src.indexOf('<script src=', bodyStart);
const markup = src.slice(bodyStart, firstScript).trim();
const cdn = src.slice(firstScript).match(/<script src="[^"]+"><\/script>/g) || [];

// 3) 앱 스크립트 (마지막 인라인 <script>)
const appStart = src.lastIndexOf('<script>');
let app = src.slice(appStart + '<script>'.length, src.lastIndexOf('</script>'));

const patches = [
  ['로그인을 Supabase Auth로',
    /  let a=accounts\.find\(x=>x\.id===id\),ok=false,dpw=false;[\s\S]*?  startSession\(a,dpw\);/,
    `  const b=$('#lg-btn');if(b){b.disabled=true;b.textContent='로그인 중…';}
  let a=null;try{a=await ICTMS.signIn(id,pw);}catch(e){err(e.message||'로그인에 실패했습니다.');}
  if(b){b.disabled=false;b.textContent='로그인';}
  if(!a)return;
  startSession(a,false);`],
  ['계정 저장을 서버(Edge Function)로',
    /async function putAccount\(id,f,pw,old\)\{[\s\S]*?updatedAt:new Date\(\)\.toISOString\(\)\}\);\}/,
    'async function putAccount(id,f,pw,old){await ICTMS.putAccount(id,f,pw,old);}'],
  ['현재 비밀번호 확인을 서버로',
    /const cur=a\?\(await sha\(p0\.value,a\.salt\)\)===a\.hash:\(acct\.id==='admin'&&\(p0\.value==='admin123'\|\|p0\.value==='12345'\)\);/,
    'const cur=await ICTMS.verifyPassword(p0.value);'],
  ['로그아웃 시 세션 종료',
    'async function logout(){await flush();acct=null;',
    'async function logout(){await flush();await ICTMS.signOut();acct=null;'],
  ['새로고침해도 로그인 유지',
    /  renderGate\(\);\n\}\nfunction refresh\(\)\{/,
    '  renderGate();\n  const sa=await ICTMS.restore();if(sa)startSession(sa,false);\n}\nfunction refresh(){'],
  ['보고서 사진을 서명 URL로',
    'const res=await fetch(blobUrl(id));',
    'const res=await fetch(await ICTMS.photoUrl(id));'],
  ['둘러보기의 고정 데모 계정 제거 (데모 배포에서만 환경변수로 켬)',
    "[['통합관리자','admin','12345'],['고객','guest','guest123'],['점검업체','jsolution','jsol1234']].forEach(",
    '(ICTMS.demoAccounts||[]).forEach('],
  ['통합관리자 메뉴: 홈·이슈·설정만 (점검·리포트·케이블 메뉴 제외)',
    /:\['insp','reports','dash','issues','settings','cables'\];(\nfunction renderNav)?/,
    ":['dash','issues','settings'];"],
  ['상단 권한 표시: 역할과 이름이 같으면 한 번만 (통합관리자 · 통합관리자 → 통합관리자)',
    "setRole(ROLES[roleKey].ko+' · '+nm)",
    "setRole(ROLES[roleKey].ko===nm?nm:ROLES[roleKey].ko+' · '+nm)"],
  ['테스트용 "로그인 없이 사용" 버튼 (VITE_QUICK_LOGIN 이 있을 때만 보임)',
    "h('button',{class:'big',style:'width:100%;margin-top:-4px',onclick:startTour},'로그인 없이 둘러보기'),",
    "h('button',{class:'big',style:'width:100%;margin-top:-4px',onclick:startTour},'로그인 없이 둘러보기'),\n" +
    "    ICTMS.quickLogin?h('button',{class:'pri big',id:'quick-btn',style:'width:100%;margin-top:-4px',onclick:async()=>{const b=$('#quick-btn');b.disabled=true;b.textContent='들어가는 중…';" +
    "try{startSession(await ICTMS.quickLogin(),false);}catch(e){b.disabled=false;b.textContent='로그인 없이 사용 (테스트)';const g=$('#gerr');if(g)g.replaceChildren(h('div',{class:'note err'},e.message||'실패'));}}},'로그인 없이 사용 (테스트)'):null,"],
];
for (const [name, from, to] of patches) {
  const hit = typeof from === 'string' ? app.split(from).length - 1 : (app.match(new RegExp(from.source, 'g')) || []).length;
  if (hit !== 1) throw new Error(`패치 실패 [${name}]: ${hit}곳 일치 (1곳이어야 함)`);
  app = app.replace(from, to);
}
// 비밀번호 최소 길이 4 → 8 (Supabase Auth 설정과 맞춤)
const n4 = (app.match(/length<4\)/g) || []).length;
app = app.replace(/(\.value\.length)<4\)/g, '$1<8)').replace(/4자 이상/g, '8자 이상');
if (n4 < 3) throw new Error('비밀번호 길이 규칙 패치 실패');

writeFileSync(join(root, 'public/app.js'), '/* Easy ICT Master — artifact/source.html 에서 생성됨 (npm run split). 직접 고치지 말고 원본을 고친 뒤 다시 생성하세요. */\n' + app.trim() + '\n');

// 4) index.html
const head = src.slice(0, src.indexOf('<script>')) // doctype ~ meta (단독 실행용 저장소 스크립트 이전)
  .replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
  .replace('<meta name="robots" content="noindex,nofollow">', [
    '<meta name="robots" content="noindex,nofollow">',
    // 홈 화면에 추가했을 때 주소창 없이 꽉 찬 앱 화면으로 열리게
    '<meta name="theme-color" content="#f3f3f2">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
    '<meta name="apple-mobile-web-app-title" content="ICT Master">',
    '<link rel="manifest" href="/manifest.webmanifest">',
    '<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">',
    '<link rel="preload" href="/fonts/Paperlogy.woff2" as="font" type="font/woff2" crossorigin>',
    '<link rel="stylesheet" href="/app.css">',
  ].join('\n'));
if (!head.includes('viewport-fit=cover')) throw new Error('viewport 메타 패치 실패');
const html = `${head.trim()}
</head>
<body>
${markup}
${cdn.join('\n')}
<script type="module" src="/src/main.js"></script>
</body>
</html>
`;
writeFileSync(join(root, 'index.html'), html);

console.log('완료: index.html, public/app.css, public/app.js, public/fonts/Paperlogy.woff2');
console.log(`  앱 코드 ${(app.length / 1024).toFixed(0)}KB · CSS ${(css.length / 1024).toFixed(0)}KB · 폰트 ${(fm[1].length * 0.75 / 1024).toFixed(0)}KB · 패치 ${patches.length + 1}건`);
