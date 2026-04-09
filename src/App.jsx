import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase.js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
const STRIPE_PRICE_ID = import.meta.env.VITE_STRIPE_PRICE_ID

const C = {
  linen:'#f0e6d0',cream:'#faf6ee',espresso:'#241708',
  moss:'#3e5e36',herb:'#6b8a5c',clay:'#a84e30',
  sand:'#b8955e',parchment:'#d8c8a8',mist:'#e8f0e0',
}

// ─── Claude API call ───────────────────────────────────────────
async function callClaude(system, userMsg, maxTokens = 1500) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }),
  })
  const data = await res.json()
  return JSON.parse((data.content?.[0]?.text || '').replace(/```json|```/g, '').trim())
}

// ─── DB helpers ────────────────────────────────────────────────
async function dbGet(table, userId) {
  const { data } = await supabase.from(table).select('*').eq('user_id', userId)
  return data || []
}
async function dbUpsert(table, payload) {
  await supabase.from(table).upsert(payload)
}
async function dbDelete(table, id) {
  await supabase.from(table).delete().eq('id', id)
}

// ─── Prompts ───────────────────────────────────────────────────
const CHECKER_PROMPT = `あなたは「SOZAI TABLE」の添加物・調味料アドバイザーです。
天然塩・天然醸造味噌・丸大豆醤油・本みりん・黒糖が良い。リン酸塩・MSG・たんぱく加水分解物・酵母エキス・酒精は避ける。
判定：◎本物・推奨 ○許容範囲 △要注意 ×避けるべき
以下のJSONのみで返答：{"verdict":"◎","verdictLabel":"本物・推奨","summary":"30文字以内","reason":"150文字以内","tips":"100文字以内","additives":["成分名"]}`

const RECIPE_PROMPT = `あなたは「SOZAI TABLE」の惣菜レシピアドバイザーです。
和惣菜中心で家庭で作りやすいものを3品提案。調味料は天然のもののみ。化学調味料・リン酸塩不使用。
以下のJSONのみで返答：{"recipes":[{"name":"料理名","category":"主菜または副菜または汁物または常備菜","mainIngredients":["食材1","食材2","食材3"],"why":"60文字以内","nutrition":"50文字以内","method":"120文字以内","time":"調理時間"}]}`

const NUTRITION_PROMPT = `あなたは「SOZAI TABLE」の食材栄養解説アドバイザーです。
以下のJSONのみで返答：{"overview":"概要80文字以内","nutrients":[{"name":"栄養素名","effect":"効果60文字以内"}],"cooking":"調理法100文字以内","pairing":["食材1","食材2","食材3"],"season_reason":"今この季節に食べる意味80文字以内"}`

const PROGRAM_PROMPT = `あなたは「SOZAI TABLE」の味覚リセット・食生活改善アドバイザーです。
以下のJSONのみで返答：{"title":"タイトル20文字以内","overview":"概要100文字以内","week1":{"theme":"テーマ15文字以内","focus":"重点60文字以内","dailyTasks":["タスク1","タスク2","タスク3"],"keyFood":"注目食材50文字以内"},"week2":{"theme":"テーマ15文字以内","focus":"重点60文字以内","dailyTasks":["タスク1","タスク2","タスク3"],"keyFood":"注目食材50文字以内"},"checkpoints":["確認1","確認2","確認3"],"encouragement":"一言50文字以内"}`

const QA_PROMPT = `あなたは「SOZAI TABLE」のAI相談アドバイザーです。食・栄養・調味料・添加物について300文字以内で回答。
以下のJSONのみで返答：{"answer":"回答（300文字以内、改行は\\nで）","tips":"実践のヒント80文字以内","recipeKeywords":["食材1","食材2"],"relatedFeature":null}`

// ─── Static data ───────────────────────────────────────────────
const APRIL_INGREDIENTS = [
  {id:'warabi',name:'わらび',category:'山菜',season:'3〜5月',accent:'#4a6741',points:['鉄分・食物繊維','肝臓の解毒サポート']},
  {id:'fukinoto',name:'ふきのとう',category:'山菜',season:'2〜4月',accent:'#6b8a5c',points:['強力な抗酸化作用','ビタミンK豊富']},
  {id:'taranome',name:'たらの芽',category:'山菜',season:'3〜5月',accent:'#3e5e36',points:['βカロテン豊富','食物繊維で整腸']},
  {id:'harukyabetsu',name:'春キャベツ',category:'野菜',season:'3〜5月',accent:'#7a9e6a',points:['ビタミンCが豊富','ベジファーストで血糖値安定']},
  {id:'shin_tamanegi',name:'新玉ねぎ',category:'野菜',season:'3〜5月',accent:'#b8955e',points:['アリシンで疲労回復','血液サラサラ効果']},
  {id:'asatsuki',name:'あさつき',category:'薬味',season:'3〜5月',accent:'#5a7a3a',points:['硫化アリルで殺菌','消化を助ける']},
]
const VERDICT_CONFIG = {'◎':{bg:'#e8f4ec',border:'#3e5e36',text:'#2d5a35'},'○':{bg:'#f0f6e8',border:'#6b8a5c',text:'#4a6741'},'△':{bg:'#fdf4e0',border:'#c47c2f',text:'#8b5e0a'},'×':{bg:'#fdecea',border:'#b05a3a',text:'#8b2a1a'}}
const CATEGORY_COLOR = {'主菜':{bg:'#fdecea',text:'#8b2a1a'},'副菜':{bg:'#e8f4ec',text:'#2d5a35'},'汁物':{bg:'#e8eef8',text:'#1a3a7a'},'常備菜':{bg:'#fdf4e0',text:'#8b5e0a'}}
const CONDITIONS = ['疲れている','血糖値が気になる','貧血気味','胃腸が弱っている','冷えを感じる','むくみが気になる']
const SCENES = ['家族と食べたい','一人ご飯','お弁当に','時間がない','作り置きしたい','子どもも食べる']
const VALUES = ['添加物を避けたい','ミネラルを増やしたい','発酵食品を取り入れたい','タンパク質を増やしたい','腸活したい','旬の食材を使いたい']
const GOALS = ['味覚をリセットしたい','添加物を減らしたい','ミネラルを増やしたい','腸内環境を整えたい','疲れにくい体を作りたい','血糖値を安定させたい']
const CURRENTS = ['加工食品を毎日食べる','外食が多い','甘いものがやめられない','インスタント食品に頼りがち','出汁はだしの素を使っている','体が疲れやすい']
const VALUES2 = ['無理なく続けたい','家族と一緒に取り組みたい','料理の時間は短くしたい','食材にこだわりたい','科学的な根拠を知りたい','体の変化を実感したい']
const QUICK_QUESTIONS = ['この味噌は本物ですか？','疲れているとき何を食べればいい？','リン酸塩を避けるにはどうすれば？','出汁の引き方を教えてください','血糖値を上げにくい惣菜は？','添加物を減らす最初の一歩は？']
const COLUMNS = [
  {id:'2026-04',month:'2026年 4月',title:'春の苦みと、体の目覚め',subtitle:'山菜が教えてくれる、自然のデトックス',date:'2026年4月1日',readTime:'約3分',tag:'季節の食',
    body:[{type:'lead',text:'料理教室で「なぜ春の山菜はあんなに苦いのか？」という質問を受けます。あの苦さには、体の目覚めを促す深い意味があります。'},{type:'heading',text:'冬眠明けの体に、苦みが必要な理由'},{type:'body',text:'冬の間、私たちの体は活動量を落とし、脂肪や老廃物を蓄える傾向があります。春の山菜に含まれる苦み成分は、肝臓の解毒機能を活性化し、冬に溜まったものを押し流す働きをします。'},{type:'highlight',text:'春の苦みは、冬眠から覚める体へのギフト。苦いものを「美味しい」と感じる味覚こそ、健康の証です。'},{type:'recipe_tip',title:'今月のひとてま',text:'ふきのとう味噌（ふきみそ）を作り置きしておくと、豆腐にのせる、ご飯に混ぜるなど、日常の惣菜がぐっと春らしくなります。'},{type:'closing',text:'食は、季節と体の対話です。春の食卓から、その会話を始めてみましょう。'}],
    qa:[{q:'ふきみそはどうやって作りますか？',a:'ふきのとうをみじん切りにして、ごま油で軽く炒めます。天然醸造の味噌・きび砂糖・本みりんを加えて弱火で練るだけ。冷蔵で2週間保存できます。'},{q:'山菜のアク抜きはどのくらい行えばいい？',a:'わらびは重曹（水1Lに小さじ1）で一晩。こごみは塩茹で1〜2分。ほんのり残す程度が栄養と風味のバランスがいい。'}]
  },
  {id:'2026-03',month:'2026年 3月',title:'天然出汁を、日常に',subtitle:'だしの素をやめた日から、料理が変わった',date:'2026年3月1日',readTime:'約3分',tag:'調味料',
    body:[{type:'lead',text:'「昆布と鰹節でちゃんと出汁を引く」と聞くと、手間がかかりそうと思う方が多い。でも実際は、パスタを茹でるより簡単です。'},{type:'highlight',text:'昆布と鰹節の出汁に戻ると、最初の2週間は「物足りない」と感じることも。でも3週間後には、その繊細さが「美味しい」に変わります。'},{type:'closing',text:'今月は、一度だけ天然出汁で味噌汁を作ってみてください。それだけで十分です。'}],
    qa:[{q:'出汁の引き方を教えてください',a:'水1Lに昆布10gを入れて30分置き、弱火でゆっくり温めます。沸騰直前で昆布を取り出し、鰹節20gを入れて火を止め、3分後に漉すだけ。'}]
  },
]

// ─── Shared components ─────────────────────────────────────────
const Logo = ({size=26,color='#faf6ee'}) => (
  <svg width={size} height={size} viewBox="0 0 52 52">
    <circle cx="26" cy="26" r="24" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.3)" strokeWidth="1"/>
    <path d="M10 30 Q26 44 42 30" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"/>
    <path d="M14 30 L38 30" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M26 30 L26 15" stroke={color} strokeWidth="1.6" strokeLinecap="round"/>
    <path d="M26 25 C26 25 16 19 14 10 C19 9 27 18 26 25Z" fill={color}/>
    <path d="M26 21 C26 21 36 15 38 6 C33 5 25 14 26 21Z" fill={color}/>
    <circle cx="26" cy="14" r="3.5" fill="#a84e30"/>
  </svg>
)
const AppBar = ({title,onBack,rightEl}) => (
  <div style={{background:C.moss,padding:'12px 18px 14px',position:'sticky',top:0,zIndex:10}}>
    <div style={{display:'flex',alignItems:'center',gap:12}}>
      {onBack && <button onClick={onBack} style={{background:'none',border:'none',color:C.cream,fontSize:22,cursor:'pointer',padding:'0 4px 0 0',lineHeight:1}}>←</button>}
      {!onBack && <Logo/>}
      <div style={{flex:1}}>{onBack?<div style={{fontFamily:'Georgia,serif',fontSize:15,color:C.cream,letterSpacing:1}}>{title}</div>:<><div style={{fontFamily:'Georgia,serif',fontSize:15,letterSpacing:3,color:C.cream}}>SOZAI</div><div style={{fontFamily:'Georgia,serif',fontSize:8,letterSpacing:5,color:'rgba(250,246,238,0.55)'}}>TABLE</div></>}</div>
      {rightEl}
      {!onBack && <div style={{fontSize:9,background:C.clay,color:C.cream,padding:'3px 10px',borderRadius:20}}>4月版</div>}
    </div>
  </div>
)
const Chip = ({label,active,onClick}) => <span onClick={onClick} style={{fontSize:10,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${active?C.moss:C.parchment}`,background:active?C.moss:C.cream,color:active?C.cream:C.espresso,display:'inline-block'}}>{label}</span>
const SaveBtn = ({saved,onSave,small}) => <button onClick={onSave} style={{background:saved?C.moss:'none',border:`1px solid ${saved?C.moss:C.parchment}`,borderRadius:10,padding:small?'4px 10px':'6px 14px',fontSize:small?9:10,color:saved?C.cream:C.sand,cursor:'pointer',flexShrink:0}}>{saved?'★ 保存済み':'☆ 保存する'}</button>
const fmtDate = ts => {const d=new Date(ts);return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`}

// ─── AUTH SCREEN ───────────────────────────────────────────────
function AuthScreen({onAuth}) {
  const [mode,setMode] = useState('login') // login | signup | forgot
  const [email,setEmail] = useState('')
  const [password,setPassword] = useState('')
  const [loading,setLoading] = useState(false)
  const [msg,setMsg] = useState(null)
  const [err,setErr] = useState(null)

  const validatePassword = (pw) => {
    if (pw.length < 8) return 'パスワードは8文字以上にしてください'
    if (!/[a-zA-Z]/.test(pw)) return 'パスワードに英字を含めてください'
    if (!/[0-9]/.test(pw)) return 'パスワードに数字を含めてください'
    return null
  }

const handle = async () => {
  if (!email || !password) return
  setLoading(true); setErr(null); setMsg(null)
  try {
    if (mode === 'signup') {
      const pwErr = validatePassword(password)
      if (pwErr) { setErr(pwErr); setLoading(false); return }

      // 24時間以内の再送チェック（送信前）
      const sentKey = `signup_sent_${email}`
      const lastSent = localStorage.getItem(sentKey)
      const now = Date.now()
      if (lastSent && now - parseInt(lastSent) < 86400000) {
        setErr('確認メールは既に送信済みです。24時間以内に再送はできません。迷惑メールフォルダもご確認ください。')
        setLoading(false)
        return
      }

      const {error: signUpError, data: signUpData} = await supabase.auth.signUp({
  email, password,
  options: { emailRedirectTo: window.location.origin }
})
if (signUpError) {
  if (signUpError.message.includes('already registered') || signUpError.message.includes('User already registered')) {
    setErr('既にアカウントが発行済みです。「食卓へ入る」からログインしてください。')
  } else {
    throw signUpError
  }
  return
}

// 本登録済みユーザーの判定
if (signUpData?.user?.identities?.length === 0) {
  setErr('既にアカウントが発行済みです。「食卓へ入る」からログインしてください。')
  return
}

      // 送信成功したら時刻を保存
      localStorage.setItem(sentKey, now.toString())
      setMsg('【SOZAI TABLE】確認メールを送りました。メール内のリンクをクリックしてログインしてください。迷惑メールフォルダもご確認ください。')

    } else {
      const {data,error} = await supabase.auth.signInWithPassword({email,password})
      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          setErr('メールアドレスまたはパスワードが正しくありません。')
        } else if (error.message.includes('Email not confirmed')) {
          setErr('メールアドレスの確認が完了していません。届いた確認メールのリンクをクリックしてください。')
        } else {
          throw error
        }
        return
      }
      onAuth(data.user)
    }
  } catch(e) { setErr(e.message) }
  finally { setLoading(false) }
}

  const handleForgot = async () => {
    if (!email) { setErr('メールアドレスを入力してください'); return }
    setLoading(true)
    const {error} = await supabase.auth.resetPasswordForEmail(email)
    if (error) setErr(error.message)
    else setMsg('パスワードリセットのメールを送りました。')
    setLoading(false)
  }

  // 会員特典リスト
  const FEATURES = [
    {icon:'🔍', name:'添加物チェッカー', desc:'商品名や成分表示を入力するだけで、AIが「本物かどうか」を即座に判定。リン酸塩・化学調味料・「無添加」のからくりまで解説します。'},
    {icon:'🥘', name:'惣菜レシピ提案',   desc:'今日の体調・シーン・食へのこだわりを選ぶと、シェフの知識をもとにAIがあなただけの惣菜3品を提案。天然調味料だけを使ったレシピです。'},
    {icon:'🌿', name:'食材の栄養解説',   desc:'旬の食材の栄養・体への効果・栄養を逃さない調理法を毎月更新。「なぜ春の山菜は苦いのか」という問いへの科学的な答えがここにあります。'},
    {icon:'📋', name:'マイプログラム',   desc:'目標と現在の食生活を入力すると、AIが2週間の味覚リセットプログラムを設計。毎日のタスクをチェックしながら、体を少しずつ整えていきます。'},
    {icon:'✉️', name:'シェフのコラム',   desc:'現役シェフが毎月1日に執筆する読み物コンテンツ。料理教室では語りきれなかった食の知恵と、季節の食材への深い洞察をお届けします。'},
    {icon:'💬', name:'Q&A相談',         desc:'食・栄養・調味料・添加物について、AIがすぐに回答。さらに毎月1回、シェフが厳選した質問にコメントします。料理の相談相手がいつでもそばに。'},
  ]

  return (
    <div style={{background:C.linen,minHeight:'100vh',fontFamily:"system-ui,'Hiragino Sans',sans-serif"}}>
      {/* Header */}
      <div style={{background:C.moss,padding:'36px 24px 40px',display:'flex',flexDirection:'column',alignItems:'center',gap:14}}>
        <svg width="60" height="60" viewBox="0 0 52 52">
          <circle cx="26" cy="26" r="24" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2"/>
          <path d="M10 30 Q26 44 42 30" fill="none" stroke="#faf6ee" strokeWidth="2.2" strokeLinecap="round"/>
          <path d="M14 30 L38 30" stroke="#faf6ee" strokeWidth="1.8" strokeLinecap="round"/>
          <path d="M26 30 L26 15" stroke="#faf6ee" strokeWidth="1.6" strokeLinecap="round"/>
          <path d="M26 25 C26 25 16 19 14 10 C19 9 27 18 26 25Z" fill="#faf6ee"/>
          <path d="M26 21 C26 21 36 15 38 6 C33 5 25 14 26 21Z" fill="#faf6ee"/>
          <circle cx="26" cy="14" r="3.5" fill="#a84e30"/>
        </svg>
        <div style={{textAlign:'center'}}>
          <div style={{fontFamily:'Georgia,serif',fontSize:24,letterSpacing:5,color:C.cream}}>SOZAI</div>
          <div style={{fontFamily:'Georgia,serif',fontSize:11,letterSpacing:8,color:'rgba(250,246,238,0.6)',fontStyle:'italic'}}>TABLE</div>
        </div>
        <div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:'rgba(250,246,238,0.75)',textAlign:'center',lineHeight:1.7}}>
          {mode==='signup'?'アカウントを作成して、はじめる':mode==='forgot'?'パスワードをリセットする':'毎日の食卓が、あなたをつくっている。'}
        </div>
      </div>
      <div style={{background:C.moss,height:24,borderRadius:'0 0 50% 50%/0 0 24px 24px',marginBottom:8}}/>

      <div style={{padding:'16px 24px 32px'}}>
        {err && <div style={{background:'#fdecea',border:'1px solid #f0b8a8',borderRadius:12,padding:'10px 14px',fontSize:11,color:'#8b2a1a',marginBottom:14}}>{err}</div>}
        {msg && <div style={{background:C.mist,border:'1px solid #b8d0a4',borderRadius:12,padding:'10px 14px',fontSize:12,color:C.moss,marginBottom:14,lineHeight:1.7}}>{msg}</div>}

        <div style={{marginBottom:14}}>
          <div style={{fontSize:9,color:C.herb,letterSpacing:1,marginBottom:6}}>メールアドレス</div>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
            placeholder="example@email.com"
            style={{width:'100%',background:C.cream,border:`1.5px solid ${C.parchment}`,borderRadius:12,padding:'12px 14px',fontSize:13,color:C.espresso,outline:'none',boxSizing:'border-box',fontFamily:"system-ui,sans-serif"}}
          />
        </div>

        {mode !== 'forgot' && (
          <div style={{marginBottom:mode==='signup'?8:20}}>
            <div style={{fontSize:9,color:C.herb,letterSpacing:1,marginBottom:6}}>パスワード</div>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&handle()}
              placeholder={mode==='signup'?'英数字を含む8文字以上':'パスワード'}
              style={{width:'100%',background:C.cream,border:`1.5px solid ${C.parchment}`,borderRadius:12,padding:'12px 14px',fontSize:13,color:C.espresso,outline:'none',boxSizing:'border-box',fontFamily:"system-ui,sans-serif"}}
            />
            {mode==='signup' && (
              <div style={{fontSize:10,color:C.sand,marginTop:6,lineHeight:1.6}}>
                ・8文字以上　・英字（a-z / A-Z）を含む　・数字（0-9）を含む
              </div>
            )}
          </div>
        )}
        {mode==='signup' && <div style={{marginBottom:20}}/>}

        <button
          onClick={mode==='forgot'?handleForgot:handle}
          disabled={loading}
          style={{width:'100%',background:loading?C.parchment:C.moss,border:'none',borderRadius:14,padding:15,fontFamily:'Georgia,serif',fontSize:14,letterSpacing:2,color:loading?C.sand:C.cream,cursor:loading?'default':'pointer',marginBottom:16}}
        >
          {loading?'処理中...':{login:'食卓へ入る',signup:'アカウントを作成',forgot:'メールを送る'}[mode]}
        </button>

        <div style={{display:'flex',flexDirection:'column',gap:10,alignItems:'center'}}>
          {mode==='login' && <>
            <button onClick={()=>{setMode('signup');setErr(null);setMsg(null)}} style={{background:'none',border:`1px solid ${C.parchment}`,borderRadius:10,padding:'8px 20px',fontSize:11,color:C.sand,cursor:'pointer'}}>
              はじめての方 → アカウントを作成
            </button>
            <button onClick={()=>{setMode('forgot');setErr(null);setMsg(null)}} style={{background:'none',border:'none',fontSize:10,color:C.sand,cursor:'pointer',textDecoration:'underline'}}>
              パスワードを忘れた方
            </button>
          </>}
          {mode !== 'login' && (
            <button onClick={()=>{setMode('login');setErr(null);setMsg(null)}} style={{background:'none',border:`1px solid ${C.parchment}`,borderRadius:10,padding:'8px 20px',fontSize:11,color:C.sand,cursor:'pointer'}}>
              ← ログイン画面に戻る
            </button>
          )}
        </div>

        {/* ─── 新規会員向け特典紹介（ログイン画面のみ表示） ─── */}
        {mode === 'login' && (
          <div style={{marginTop:40}}>
            <div style={{textAlign:'center',marginBottom:24}}>
              <div style={{fontSize:8,color:C.sand,letterSpacing:3,marginBottom:10}}>SOZAI TABLE とは</div>
              <div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:16,color:C.espresso,lineHeight:1.8,fontWeight:'normal'}}>
                料理教室で学んだ知識が、<br/>毎日の食卓でいきる。
              </div>
              <div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:C.herb,lineHeight:1.8,marginTop:8}}>
                現役シェフの食の科学と、AIの力を組み合わせた<br/>月額750円のパーソナル食アドバイザーです。
              </div>
            </div>

            {/* 特典カード */}
            {FEATURES.map((f,i)=>(
              <div key={i} style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:16,padding:'16px 18px',marginBottom:10}}>
                <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                  <div style={{fontSize:22,flexShrink:0,marginTop:2}}>{f.icon}</div>
                  <div>
                    <div style={{fontSize:13,fontWeight:500,color:C.espresso,marginBottom:5}}>{f.name}</div>
                    <div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:'#6a7860',lineHeight:1.75}}>{f.desc}</div>
                  </div>
                </div>
              </div>
            ))}

            {/* 価格と申し込みCTA */}
            <div style={{background:C.moss,borderRadius:16,padding:'20px 20px',marginTop:20,textAlign:'center'}}>
              <div style={{fontSize:9,color:'rgba(250,246,238,0.6)',letterSpacing:2,marginBottom:8}}>月額メンバーシップ</div>
              <div style={{fontFamily:'Georgia,serif',fontSize:28,color:C.cream,marginBottom:4}}>¥750<span style={{fontSize:13,color:'rgba(250,246,238,0.7)'}}>/月</span></div>
              <div style={{fontSize:10,color:'rgba(250,246,238,0.65)',marginBottom:16,lineHeight:1.6}}>クレジットカード決済・いつでも解約可能</div>
              <button onClick={()=>{setMode('signup');setErr(null);setMsg(null)}}
                style={{width:'100%',background:C.clay,border:'none',borderRadius:12,padding:'14px',fontFamily:'Georgia,serif',fontSize:14,letterSpacing:2,color:C.cream,cursor:'pointer'}}>
                いますぐはじめる
              </button>
            </div>

            <div style={{textAlign:'center',marginTop:16,fontSize:10,color:C.sand,lineHeight:1.8}}>
              「現役シェフに学ぶ、味と体を設計する惣菜講座」<br/>受講者の方もこちらからご登録ください。
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PAYMENT SCREEN ────────────────────────────────────────────
function PaymentScreen({user,onSuccess,onLogout}) {
  const [loading,setLoading] = useState(false)

  const handleSubscribe = async () => {
    setLoading(true)
    try {
      const {data,error} = await supabase.functions.invoke('create-checkout',{
        body:{
          userId: user.id,
          email: user.email,
          priceId: STRIPE_PRICE_ID,
          successUrl: `${window.location.origin}?payment=success`,
          cancelUrl: `${window.location.origin}?payment=cancel`,
        }
      })
      if (error) throw error
      if (data.url) window.location.href = data.url
    } catch(e) {
      alert('エラーが発生しました。もう一度お試しください。')
    } finally { setLoading(false) }
  }

  return (
    <div style={{background:C.linen,minHeight:'100vh',fontFamily:"system-ui,'Hiragino Sans',sans-serif"}}>
      <div style={{background:C.moss,padding:'36px 24px 40px',display:'flex',flexDirection:'column',alignItems:'center',gap:14}}>
        <Logo size={56}/>
        <div style={{textAlign:'center'}}>
          <div style={{fontFamily:'Georgia,serif',fontSize:22,letterSpacing:4,color:C.cream}}>SOZAI TABLE</div>
          <div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:'rgba(250,246,238,0.7)',marginTop:6}}>月額メンバーシップ</div>
        </div>
      </div>
      <div style={{background:C.moss,height:24,borderRadius:'0 0 50% 50%/0 0 24px 24px',marginBottom:8}}/>

      <div style={{padding:'20px 20px 32px'}}>
        <div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:13,color:C.espresso,lineHeight:1.8,marginBottom:24,textAlign:'center'}}>
          {user.email} でログイン中
        </div>

        {/* プラン説明 */}
        <div style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:16,padding:20,marginBottom:16}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
            <div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:16,color:C.espresso}}>月額プラン</div>
            <div>
              <span style={{fontFamily:'Georgia,serif',fontSize:24,color:C.espresso}}>¥750</span>
              <span style={{fontSize:11,color:C.sand}}>/月</span>
            </div>
          </div>
          {[
            ['添加物チェッカー','調味料・食材をAIが即判定'],
            ['惣菜レシピ提案','体調・シーン・価値観に合わせて'],
            ['食材の栄養解説','旬の食材を毎月更新'],
            ['マイプログラム','2週間の味覚リセット設計'],
            ['シェフのコラム','毎月1日更新'],
            ['Q&A相談','AI即答＋月1シェフ確認'],
          ].map(([name,desc])=>(
            <div key={name} style={{display:'flex',gap:10,alignItems:'flex-start',marginBottom:10}}>
              <div style={{width:18,height:18,borderRadius:'50%',background:C.moss,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>
                <div style={{color:C.cream,fontSize:10,fontWeight:700}}>✓</div>
              </div>
              <div>
                <div style={{fontSize:12,fontWeight:500,color:C.espresso}}>{name}</div>
                <div style={{fontSize:10,color:C.sand}}>{desc}</div>
              </div>
            </div>
          ))}
        </div>

        <button onClick={handleSubscribe} disabled={loading} style={{width:'100%',background:loading?C.parchment:C.clay,border:'none',borderRadius:14,padding:16,fontFamily:'Georgia,serif',fontSize:15,letterSpacing:2,color:loading?C.sand:C.cream,cursor:loading?'default':'pointer',marginBottom:12}}>
          {loading?'処理中...':'Stripeで月額登録する'}
        </button>

        <div style={{fontSize:10,color:C.sand,textAlign:'center',lineHeight:1.7,marginBottom:20}}>
          クレジットカードで安全に決済（Stripe）<br/>
          いつでも解約できます
        </div>

        <button onClick={onLogout} style={{width:'100%',background:'none',border:`1px solid ${C.parchment}`,borderRadius:12,padding:12,fontSize:11,color:C.sand,cursor:'pointer'}}>
          ログアウト
        </button>
      </div>
    </div>
  )
}

// ─── MAIN APP (after auth + payment) ──────────────────────────
function MainApp({user,onLogout}) {
  const [screen,setScreen] = useState('home')
  const [savedRecipes,setSavedRecipes] = useState([])
  const [savedNutrition,setSavedNutrition] = useState([])
  const [currentProgram,setCurrentProgram] = useState(null)

  // DBからデータ読み込み
  useEffect(() => {
    if (!user) return;
    (async () => {
      const recipes = await dbGet('saved_recipes', user.id)
      const nutrition = await dbGet('saved_nutrition', user.id)
      const {data:prog} = await supabase.from('user_programs').select('*').eq('user_id',user.id).single()
      setSavedRecipes(recipes.map(r=>({...r.recipe_data,dbId:r.id,savedAt:new Date(r.saved_at).getTime()})))
      setSavedNutrition(nutrition.map(n=>({id:n.ingredient_data?.id,ingredient:n.ingredient_data,detail:n.detail_data,dbId:n.id,savedAt:new Date(n.saved_at).getTime()})))
      if (prog) setCurrentProgram(prog.program_data)
    })()
  },[user])

  const saveRecipe = async (recipe) => {
    if (savedRecipes.some(s=>s.name===recipe.name)) return
    const {data} = await supabase.from('saved_recipes').insert({user_id:user.id,recipe_data:recipe}).select().single()
    if (data) setSavedRecipes(prev=>[{...recipe,dbId:data.id,savedAt:Date.now()},...prev])
  }
  const saveNutrition = async (ingredient,detail) => {
    if (savedNutrition.some(s=>s.id===ingredient.id)) return
    const {data} = await supabase.from('saved_nutrition').insert({user_id:user.id,ingredient_data:ingredient,detail_data:detail}).select().single()
    if (data) setSavedNutrition(prev=>[{id:ingredient.id,ingredient,detail,dbId:data.id,savedAt:Date.now()},...prev])
  }
  const saveProgram = async (prog) => {
    setCurrentProgram(prog)
    await supabase.from('user_programs').upsert({user_id:user.id,program_data:prog,updated_at:new Date().toISOString()})
  }
  const deleteSaved = async (type,dbId) => {
    if (type==='recipe') {
      await supabase.from('saved_recipes').delete().eq('id',dbId)
      setSavedRecipes(prev=>prev.filter(s=>s.dbId!==dbId))
    } else {
      await supabase.from('saved_nutrition').delete().eq('id',dbId)
      setSavedNutrition(prev=>prev.filter(s=>s.dbId!==dbId))
    }
  }

  const savedCount = savedRecipes.length + savedNutrition.length

  const props = {
    user,
    onLogout,
    savedRecipes,
    savedNutrition,
    currentProgram,
    onSaveRecipe: saveRecipe,
    onSaveNutrition: saveNutrition,
    onSaveProgram: saveProgram,
    onDelete: deleteSaved,
    savedCount,
    onNavigate: setScreen,
  }

  return (
    <div style={{maxWidth:420,margin:'0 auto',background:C.linen}}>
      {screen==='home'      && <HomeScreen      {...props}/>}
      {screen==='checker'   && <CheckerScreen   {...props} onBack={()=>setScreen('home')}/>}
      {screen==='recipe'    && <RecipeScreen     {...props} onBack={()=>setScreen('home')}/>}
      {screen==='nutrition' && <NutritionScreen  {...props} onBack={()=>setScreen('home')}/>}
      {screen==='program'   && <ProgramScreen    {...props} onBack={()=>setScreen('home')}/>}
      {screen==='column'    && <ColumnScreen     {...props} onBack={()=>setScreen('home')}/>}
      {screen==='qa'        && <QAScreen         {...props} onBack={()=>setScreen('home')}/>}
      {screen==='saved'     && <SavedScreen      {...props} onBack={()=>setScreen('home')}/>}
    </div>
  )
}

// ─── ROOT APP ──────────────────────────────────────────────────
export default function App() {
  const [user,setUser] = useState(null)
  const [subStatus,setSubStatus] = useState(null)
  const [loading,setLoading] = useState(true)

  useEffect(() => {
    // セッション確認
    supabase.auth.getSession().then(({data:{session}}) => {
      if (session?.user) {
        setUser(session.user)
        checkSubscription(session.user.id)
      } else {
        setLoading(false)
      }
    })
    // 支払い成功後のリダイレクト処理
    const params = new URLSearchParams(window.location.search)
    if (params.get('payment') === 'success') {
      window.history.replaceState({}, '', window.location.pathname)
      // 少し待ってからWebhookの処理を待つ
      setTimeout(() => window.location.reload(), 2000)
    }
    // 認証状態の変化を監視
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_,session) => {
      if (session?.user) {
        setUser(session.user)
        checkSubscription(session.user.id)
      } else {
        setUser(null)
        setSubStatus(null)
        setLoading(false)
      }
    })
    return () => subscription.unsubscribe()
  },[])

  const checkSubscription = async (userId) => {
    const {data} = await supabase.from('profiles').select('subscription_status').eq('id',userId).single()
    setSubStatus(data?.subscription_status || 'inactive')
    setLoading(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setSubStatus(null)
  }

  if (loading) {
    return (
      <div style={{background:C.linen,minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{textAlign:'center'}}>
          <Logo size={48} color={C.moss}/>
          <div style={{fontFamily:'Georgia,serif',fontSize:11,color:C.sand,marginTop:16,letterSpacing:2}}>SOZAI TABLE</div>
        </div>
      </div>
    )
  }
  if (!user) return <AuthScreen onAuth={u=>{setUser(u);checkSubscription(u.id)}}/>
  if (subStatus !== 'active') return <PaymentScreen user={user} onSuccess={()=>setSubStatus('active')} onLogout={handleLogout}/>
  return <MainApp user={user} onLogout={handleLogout}/>
}

// ─── HOME ──────────────────────────────────────────────────────
function HomeScreen({onNavigate,savedCount,onLogout,user}) {
  const latest = COLUMNS[0]
  const FEATURES = [
    {key:'checker',dot:C.moss,name:'添加物チェッカー',note:'調味料の本物を、AIが即判定'},
    {key:'recipe',dot:C.clay,name:'惣菜レシピ提案',note:'体調・シーン・価値観で'},
    {key:'nutrition',dot:C.sand,name:'食材の栄養解説',note:'旬を毎月更新'},
    {key:'program',dot:C.herb,name:'マイプログラム',note:'2週間の味覚リセット設計'},
  ]
  return (
    <div style={{background:C.linen,minHeight:'100vh',fontFamily:"system-ui,'Hiragino Sans',sans-serif"}}>
      <AppBar rightEl={
        <div style={{display:'flex',gap:6}}>
          <button onClick={()=>onNavigate('saved')} style={{background:'rgba(255,255,255,0.15)',border:'none',borderRadius:10,padding:'4px 10px',fontSize:9,color:C.cream,cursor:'pointer'}}>★ 保存{savedCount>0?` (${savedCount})`:''}</button>
          <button onClick={onLogout} style={{background:'rgba(255,255,255,0.1)',border:'none',borderRadius:10,padding:'4px 8px',fontSize:9,color:'rgba(250,246,238,0.6)',cursor:'pointer'}}>出る</button>
        </div>
      }/>
      <div style={{padding:'20px 18px 16px',borderBottom:`1px solid ${C.parchment}`}}>
        <div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:16,lineHeight:1.85,color:C.espresso,fontWeight:'normal',marginBottom:8}}>毎日の食卓が、<br/>あなたをつくっている。</div>
        <div style={{fontSize:10,color:C.herb}}>素材の力と体の知恵を、日々の暮らしへ</div>
      </div>
      <div style={{margin:'14px 14px 4px'}}>
        <div style={{fontSize:8,color:C.sand,letterSpacing:2,marginBottom:9}}>今月の旬食材</div>
        <div style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:16,overflow:'hidden'}}>
          <div style={{background:'#b8c9a0',height:72,display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{fontSize:10,color:'rgba(36,23,8,0.5)'}}>旬の食材写真（毎月更新）</div></div>
          <div style={{padding:'10px 14px 12px'}}><span style={{fontSize:8,background:C.mist,color:C.moss,border:'1px solid #b8d0a4',borderRadius:10,padding:'2px 8px',display:'inline-block',marginBottom:6}}>4月 旬</span><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:C.espresso,lineHeight:1.5,marginBottom:4}}>春の山菜と、肝臓を助けるミネラル</div><div style={{fontSize:9,color:'#8a7860',lineHeight:1.5}}>ふきのとう・わらびの苦み成分が冬の老廃物を体外へ促します。</div></div>
        </div>
      </div>
      <div style={{padding:'14px 14px 12px'}}>
        <div style={{fontSize:8,color:C.sand,letterSpacing:2,marginBottom:10}}>できること</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          {FEATURES.map((f,i)=><div key={i} onClick={()=>onNavigate(f.key)} style={{background:C.cream,border:`1.5px solid ${C.moss}`,borderRadius:14,padding:'13px 12px',cursor:'pointer'}}><div style={{width:8,height:8,borderRadius:'50%',background:f.dot,marginBottom:8}}/><div style={{fontSize:11,fontWeight:500,color:C.espresso,marginBottom:3,lineHeight:1.3}}>{f.name}</div><div style={{fontSize:9,color:'#8a7860',lineHeight:1.4}}>{f.note}</div><div style={{fontSize:8,color:C.moss,marginTop:7}}>▶ 使ってみる</div></div>)}
        </div>
      </div>
      <div style={{margin:'0 14px 12px',borderTop:`1px dashed ${C.parchment}`,paddingTop:12}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}><div style={{fontSize:8,color:C.sand,letterSpacing:2}}>シェフのコラム</div><button onClick={()=>onNavigate('column')} style={{fontSize:9,color:C.herb,background:'none',border:'none',cursor:'pointer'}}>一覧を見る →</button></div>
        <div onClick={()=>onNavigate('column')} style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:14,padding:14,cursor:'pointer'}}>
          <div style={{display:'flex',gap:10,marginBottom:10}}><div style={{width:32,height:32,borderRadius:'50%',background:C.clay,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:C.cream,fontFamily:'Georgia,serif',flexShrink:0}}>CF</div><div><div style={{fontSize:10,fontWeight:500,color:C.espresso}}>{latest.title}</div><div style={{fontSize:8,color:C.sand,marginTop:2}}>{latest.date} — {latest.readTime}</div></div></div>
          <div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:10,color:C.espresso,lineHeight:1.75,borderTop:`1px solid ${C.parchment}`,paddingTop:10}}>{latest.body.find(b=>b.type==='lead')?.text?.slice(0,70)}...</div>
          <div style={{textAlign:'right',fontSize:8,color:C.herb,marginTop:8}}>続きを読む →</div>
        </div>
      </div>
      <div style={{margin:'0 14px 28px',borderTop:`1px dashed ${C.parchment}`,paddingTop:12}}>
        <div style={{fontSize:8,color:C.sand,letterSpacing:2,marginBottom:9}}>Q &amp; A 相談</div>
        <div onClick={()=>onNavigate('qa')} style={{background:'#fdf7ee',border:'1px solid #e0c898',borderRadius:14,padding:14,cursor:'pointer'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}><div style={{fontSize:10,fontWeight:500,color:C.espresso}}>シェフ×AIに相談する</div><div style={{display:'flex',gap:4}}><span style={{fontSize:7,background:C.herb,color:C.cream,padding:'2px 6px',borderRadius:10}}>AI即答</span><span style={{fontSize:7,background:C.clay,color:C.cream,padding:'2px 6px',borderRadius:10}}>月1シェフ</span></div></div>
          <div style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:10,padding:'8px 12px',marginBottom:10,fontSize:10,color:'#a89878'}}>気になる食材や調味料を聞く…</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:4}}>{['この味噌は本物？','疲れに効く惣菜は？','リン酸塩を避けるには'].map(q=><span key={q} style={{fontSize:8,color:C.moss,background:C.mist,border:'1px solid #b8d0a4',borderRadius:20,padding:'3px 8px'}}>{q}</span>)}</div>
        </div>
      </div>
    </div>
  )
}

// ─── CHECKER ──────────────────────────────────────────────────
function CheckerScreen({onBack}) {
  const [input,setInput]=useState('');const [loading,setLoading]=useState(false);const [result,setResult]=useState(null);const [error,setError]=useState(null)
  const analyze=async()=>{if(!input.trim()||loading)return;setLoading(true);setResult(null);setError(null);try{setResult(await callClaude(CHECKER_PROMPT,`以下を分析してください：\n\n${input}`,800))}catch{setError('分析に失敗しました。')}finally{setLoading(false)}}
  const vc=result?(VERDICT_CONFIG[result.verdict]||VERDICT_CONFIG['○']):null
  return <div style={{background:C.linen,minHeight:'100vh',fontFamily:"system-ui,'Hiragino Sans',sans-serif"}}><AppBar title="添加物チェッカー" onBack={onBack}/><div style={{padding:'20px 16px'}}><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:C.herb,lineHeight:1.7,marginBottom:18}}>商品名または成分表示を入力してください。</div><textarea value={input} onChange={e=>setInput(e.target.value)} placeholder={'例：ヤマサ醤油（丸大豆醤油）\n\nまたは成分表示をそのまま貼り付け'} style={{width:'100%',minHeight:110,background:C.cream,border:`1.5px solid ${C.parchment}`,borderRadius:14,padding:'12px 14px',fontSize:12,color:C.espresso,fontFamily:'system-ui,sans-serif',lineHeight:1.65,resize:'vertical',outline:'none',boxSizing:'border-box'}}/><div style={{display:'flex',gap:5,margin:'8px 0 16px',flexWrap:'wrap'}}>{['ヤマサ醤油（丸大豆醤油）','マルコメ料亭の味','伯方の塩'].map(ex=><span key={ex} onClick={()=>setInput(ex)} style={{fontSize:9,color:C.moss,background:C.mist,border:'1px solid #b8d0a4',borderRadius:20,padding:'3px 9px',cursor:'pointer'}}>{ex}</span>)}</div><button onClick={analyze} disabled={loading||!input.trim()} style={{width:'100%',background:input.trim()&&!loading?C.moss:C.parchment,border:'none',borderRadius:14,padding:15,fontFamily:'Georgia,serif',fontSize:14,letterSpacing:2,color:input.trim()&&!loading?C.cream:C.sand,cursor:input.trim()&&!loading?'pointer':'default'}}>{loading?'分析中...':'チェックする'}</button>{loading&&<div style={{textAlign:'center',marginTop:20,fontFamily:'Georgia,serif',fontSize:11,color:C.herb,lineHeight:1.8}}>分析しています...</div>}{error&&<div style={{marginTop:14,padding:'10px 14px',background:'#fdecea',borderRadius:12,fontSize:11,color:'#8b2a1a'}}>{error}</div>}{result&&vc&&<div style={{marginTop:22}}><div style={{background:vc.bg,border:`1.5px solid ${vc.border}`,borderRadius:16,padding:16,marginBottom:12}}><div style={{display:'flex',alignItems:'center',gap:14,marginBottom:10}}><div style={{fontSize:36,lineHeight:1,color:vc.text}}>{result.verdict}</div><div><div style={{fontSize:15,fontWeight:500,color:vc.text}}>{result.verdictLabel}</div><div style={{fontSize:11,color:vc.text,opacity:0.85,marginTop:3}}>{result.summary}</div></div></div>{result.additives?.length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:4,marginTop:4}}>{result.additives.map((a,i)=><span key={i} style={{fontSize:9,background:'rgba(0,0,0,0.07)',color:vc.text,padding:'2px 8px',borderRadius:10}}>{a}</span>)}</div>}</div><div style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:14,padding:14,marginBottom:10}}><div style={{fontSize:9,color:C.sand,letterSpacing:1.5,marginBottom:7}}>判定の理由</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:C.espresso,lineHeight:1.8}}>{result.reason}</div></div><div style={{background:C.mist,border:'1px solid #b8d0a4',borderRadius:14,padding:14}}><div style={{fontSize:9,color:C.moss,letterSpacing:1.5,marginBottom:7}}>シェフのアドバイス</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:C.espresso,lineHeight:1.8}}>{result.tips}</div></div><button onClick={()=>{setInput('');setResult(null)}} style={{width:'100%',marginTop:14,background:'none',border:`1px solid ${C.parchment}`,borderRadius:14,padding:12,fontSize:11,color:C.sand,cursor:'pointer'}}>別の食材をチェックする</button></div>}</div></div>
}

// ─── RECIPE ───────────────────────────────────────────────────
function RecipeScreen({onBack,savedRecipes,onSaveRecipe}) {
  const [conditions,setConditions]=useState([]);const [scene,setScene]=useState(null);const [values,setValues]=useState([]);const [loading,setLoading]=useState(false);const [recipes,setRecipes]=useState(null);const [error,setError]=useState(null);const [expanded,setExpanded]=useState(null)
  const toggle=(arr,setArr,val)=>setArr(arr.includes(val)?arr.filter(v=>v!==val):[...arr,val])
  const canSubmit=conditions.length>0||scene||values.length>0
  const generate=async()=>{if(!canSubmit||loading)return;setLoading(true);setRecipes(null);setError(null);setExpanded(null);try{const d=await callClaude(RECIPE_PROMPT,`体調：${conditions.join('、')||'特になし'}\nシーン：${scene||'特になし'}\nこだわり：${values.join('、')||'特になし'}\n\n上記に合った惣菜を3品提案してください。`);setRecipes(d.recipes)}catch{setError('レシピの生成に失敗しました。')}finally{setLoading(false)}}
  const isSaved=r=>savedRecipes.some(s=>s.name===r.name)
  const reset=()=>{setConditions([]);setScene(null);setValues([]);setRecipes(null);setError(null);setExpanded(null)}
  return <div style={{background:C.linen,minHeight:'100vh',fontFamily:"system-ui,'Hiragino Sans',sans-serif"}}><AppBar title="惣菜レシピ提案" onBack={onBack}/><div style={{padding:'20px 16px'}}>{!recipes&&!loading&&<><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:C.herb,lineHeight:1.7,marginBottom:22}}>今のあなたに合った惣菜を提案します。</div><div style={{marginBottom:20}}><div style={{fontSize:9,color:C.sand,letterSpacing:1.5,marginBottom:10}}>今の体調（複数可）</div><div style={{display:'flex',flexWrap:'wrap',gap:6}}>{CONDITIONS.map(c=><Chip key={c} label={c} active={conditions.includes(c)} onClick={()=>toggle(conditions,setConditions,c)}/>)}</div></div><div style={{marginBottom:20}}><div style={{fontSize:9,color:C.sand,letterSpacing:1.5,marginBottom:10}}>シーン（1つ）</div><div style={{display:'flex',flexWrap:'wrap',gap:6}}>{SCENES.map(s=><Chip key={s} label={s} active={scene===s} onClick={()=>setScene(scene===s?null:s)}/>)}</div></div><div style={{marginBottom:26}}><div style={{fontSize:9,color:C.sand,letterSpacing:1.5,marginBottom:10}}>食へのこだわり（複数可）</div><div style={{display:'flex',flexWrap:'wrap',gap:6}}>{VALUES.map(v=><Chip key={v} label={v} active={values.includes(v)} onClick={()=>toggle(values,setValues,v)}/>)}</div></div><button onClick={generate} disabled={!canSubmit} style={{width:'100%',background:canSubmit?C.clay:C.parchment,border:'none',borderRadius:14,padding:15,fontFamily:'Georgia,serif',fontSize:14,letterSpacing:2,color:canSubmit?C.cream:C.sand,cursor:canSubmit?'pointer':'default'}}>レシピを提案してもらう</button>{error&&<div style={{marginTop:14,padding:'10px 14px',background:'#fdecea',borderRadius:12,fontSize:11,color:'#8b2a1a'}}>{error}</div>}</>}{loading&&<div style={{textAlign:'center',padding:'60px 0',fontFamily:"Georgia,'Hiragino Mincho Pro',serif",color:C.herb,lineHeight:2}}>惣菜を選んでいます...</div>}{recipes&&<div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:13,color:C.espresso,marginBottom:18,textAlign:'center'}}>あなたへのおすすめ惣菜 3品</div>{recipes.map((r,i)=>{const catC=CATEGORY_COLOR[r.category]||{bg:'#f5f5f5',text:'#555'};const isOpen=expanded===i;return <div key={i} style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:16,marginBottom:12,overflow:'hidden'}}><div style={{padding:'14px 16px'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}><div style={{display:'flex',alignItems:'center',gap:8,flex:1}}><div style={{width:22,height:22,borderRadius:'50%',background:C.clay,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:C.cream,fontFamily:'Georgia,serif',flexShrink:0}}>{i+1}</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:14,color:C.espresso}}>{r.name}</div><span style={{fontSize:8,background:catC.bg,color:catC.text,padding:'2px 8px',borderRadius:10}}>{r.category}</span></div><SaveBtn saved={isSaved(r)} small onSave={()=>onSaveRecipe(r)}/></div><div style={{fontSize:10,color:C.herb,lineHeight:1.5,marginBottom:8}}>{r.why}</div><div style={{display:'flex',justifyContent:'space-between'}}><div style={{display:'flex',flexWrap:'wrap',gap:4}}>{r.mainIngredients?.slice(0,3).map((ing,j)=><span key={j} style={{fontSize:8,background:C.mist,color:C.moss,border:'1px solid #b8d0a4',borderRadius:10,padding:'2px 6px'}}>{ing}</span>)}</div><span style={{fontSize:8,color:C.sand}}>⏱ {r.time}</span></div></div>{isOpen&&<div style={{borderTop:`1px solid ${C.parchment}`,padding:'14px 16px',background:'#fdfaf5'}}><div style={{marginBottom:12}}><div style={{fontSize:9,color:C.sand,letterSpacing:1.5,marginBottom:6}}>栄養ポイント</div><div style={{fontSize:11,color:C.espresso,background:C.mist,border:'1px solid #b8d0a4',borderRadius:10,padding:'8px 12px',lineHeight:1.6}}>{r.nutrition}</div></div><div><div style={{fontSize:9,color:C.sand,letterSpacing:1.5,marginBottom:6}}>作り方のポイント</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:C.espresso,lineHeight:1.8}}>{r.method}</div></div></div>}<div onClick={()=>setExpanded(isOpen?null:i)} style={{textAlign:'center',padding:'8px',borderTop:`1px solid ${C.parchment}`,fontSize:9,color:C.herb,cursor:'pointer'}}>{isOpen?'▲ 閉じる':'▼ 作り方・栄養を見る'}</div></div>})}<button onClick={reset} style={{width:'100%',marginTop:6,background:'none',border:`1px solid ${C.parchment}`,borderRadius:14,padding:14,fontSize:12,color:C.sand,cursor:'pointer',fontFamily:'Georgia,serif'}}>条件を変えて再提案する</button></div>}</div></div>
}

// ─── NUTRITION ────────────────────────────────────────────────
function NutritionScreen({onBack,savedNutrition,onSaveNutrition}){const [selected,setSelected]=useState(null);const [loading,setLoading]=useState(false);const [detail,setDetail]=useState({});const [error,setError]=useState(null);const fetchDetail=async(ing)=>{setSelected(ing);if(detail[ing.id]||loading)return;setLoading(true);setError(null);try{const d=await callClaude(NUTRITION_PROMPT,`「${ing.name}」の栄養・効果・調理法・組み合わせを詳しく解説してください。`,1000);setDetail(prev=>({...prev,[ing.id]:d}))}catch{setError('解説の取得に失敗しました。')}finally{setLoading(false)}};const d=selected?detail[selected.id]:null;const isSaved=selected&&savedNutrition.some(s=>s.id===selected.id);return <div style={{background:C.linen,minHeight:'100vh',fontFamily:"system-ui,'Hiragino Sans',sans-serif"}}><AppBar title="食材の栄養解説" onBack={onBack}/><div style={{padding:'16px 16px 0'}}><div style={{background:C.moss,borderRadius:16,padding:'14px 18px',marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><div style={{fontSize:9,color:'rgba(250,246,238,0.6)',letterSpacing:2,marginBottom:4}}>2026年 4月の旬</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:15,color:C.cream}}>春の芽吹き</div></div><div style={{fontSize:9,background:C.clay,color:C.cream,padding:'3px 10px',borderRadius:20}}>6品</div></div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:16}}>{APRIL_INGREDIENTS.map(ing=><div key={ing.id} onClick={()=>fetchDetail(ing)} style={{background:selected?.id===ing.id?ing.accent:C.cream,border:`1.5px solid ${selected?.id===ing.id?ing.accent:C.parchment}`,borderRadius:14,padding:'12px 12px',cursor:'pointer'}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:13,color:selected?.id===ing.id?C.cream:C.espresso}}>{ing.name}</div><span style={{fontSize:7,background:selected?.id===ing.id?'rgba(255,255,255,0.25)':C.mist,color:selected?.id===ing.id?C.cream:C.moss,padding:'2px 6px',borderRadius:8}}>{ing.category}</span></div><div style={{fontSize:8,color:selected?.id===ing.id?'rgba(250,246,238,0.7)':C.sand,marginBottom:6}}>{ing.season}</div>{ing.points.map((p,i)=><div key={i} style={{fontSize:9,color:selected?.id===ing.id?'rgba(250,246,238,0.85)':'#6a7860',lineHeight:1.5,display:'flex',gap:4}}><span style={{color:selected?.id===ing.id?'rgba(250,246,238,0.6)':ing.accent}}>·</span>{p}</div>)}</div>)}</div>{selected&&<div style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:16,overflow:'hidden',marginBottom:24}}><div style={{background:selected.accent,padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:16,color:C.cream}}>{selected.name}</div><div style={{fontSize:9,color:'rgba(250,246,238,0.7)',marginTop:2}}>{selected.season} — {selected.category}</div></div>{d&&<SaveBtn saved={isSaved} onSave={()=>onSaveNutrition(selected,d)}/>}</div>{loading&&<div style={{padding:'32px 16px',textAlign:'center',fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:C.herb,lineHeight:2}}>調べています...</div>}{error&&<div style={{margin:14,padding:'10px 14px',background:'#fdecea',borderRadius:12,fontSize:11,color:'#8b2a1a'}}>{error}</div>}{d&&!loading&&<div style={{padding:'16px'}}><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:C.espresso,lineHeight:1.8,marginBottom:14,padding:'12px 14px',background:C.linen,borderRadius:12}}>{d.overview}</div><div style={{marginBottom:14}}>{d.nutrients?.map((n,i)=><div key={i} style={{display:'flex',gap:10,marginBottom:8}}><div style={{width:8,height:8,borderRadius:'50%',background:selected.accent,flexShrink:0,marginTop:4}}/><div><div style={{fontSize:11,fontWeight:500,color:C.espresso,marginBottom:2}}>{n.name}</div><div style={{fontSize:10,color:'#6a7860',lineHeight:1.5}}>{n.effect}</div></div></div>)}</div><div style={{background:C.mist,border:'1px solid #b8d0a4',borderRadius:12,padding:'12px 14px',fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:C.espresso,lineHeight:1.8,marginBottom:14}}>{d.cooking}</div><div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:14}}>{d.pairing?.map((p,i)=><span key={i} style={{fontSize:10,background:C.cream,border:`1px solid ${selected.accent}`,color:selected.accent,padding:'4px 12px',borderRadius:20}}>{p}</span>)}</div><div style={{background:'#fdf7ee',border:'1px solid #e0c898',borderRadius:12,padding:'12px 14px'}}><div style={{fontSize:9,color:C.clay,letterSpacing:1,marginBottom:6}}>今この季節に食べる意味</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:C.espresso,lineHeight:1.8}}>{d.season_reason}</div></div></div>}{!d&&!loading&&!error&&<div style={{padding:'20px 16px',textAlign:'center',fontSize:10,color:C.sand}}>読み込んでいます...</div>}</div>}{!selected&&<div style={{textAlign:'center',padding:'24px 0 32px',fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:C.sand,lineHeight:1.8}}>食材をタップすると栄養を解説します</div>}</div></div>}

// ─── PROGRAM ──────────────────────────────────────────────────
function ProgramScreen({onBack,currentProgram,onSaveProgram}){const [goals,setGoals]=useState([]);const [currents,setCurrents]=useState([]);const [vals,setVals]=useState([]);const [loading,setLoading]=useState(false);const [program,setProgram]=useState(currentProgram||null);const [error,setError]=useState(null);const [activeWeek,setActiveWeek]=useState(1);const [checkedTasks,setCheckedTasks]=useState({});const toggle=(arr,setArr,val)=>setArr(arr.includes(val)?arr.filter(v=>v!==val):[...arr,val]);const canSubmit=goals.length>0;const generate=async()=>{if(!canSubmit||loading)return;setLoading(true);setProgram(null);setError(null);setCheckedTasks({});try{const d=await callClaude(PROGRAM_PROMPT,`目標：${goals.join('、')}\n現在の食生活：${currents.join('、')||'特になし'}\n価値観：${vals.join('、')||'特になし'}\n\n2週間のマイプログラムを設計してください。`);setProgram(d);onSaveProgram(d)}catch{setError('プログラムの生成に失敗しました。')}finally{setLoading(false)}};const toggleTask=(week,idx)=>{const key=`w${week}-${idx}`;setCheckedTasks(prev=>({...prev,[key]:!prev[key]}))};const week=program?(activeWeek===1?program.week1:program.week2):null;const totalTasks=program?(program.week1.dailyTasks.length+program.week2.dailyTasks.length):0;const doneTasks=Object.values(checkedTasks).filter(Boolean).length;const progress=totalTasks>0?Math.round((doneTasks/totalTasks)*100):0;return <div style={{background:C.linen,minHeight:'100vh',fontFamily:"system-ui,'Hiragino Sans',sans-serif"}}><AppBar title="マイプログラム" onBack={onBack}/><div style={{padding:'20px 16px'}}>{!program&&!loading&&<><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:C.herb,lineHeight:1.8,marginBottom:22}}>あなたの目標と現状をもとに、<br/>AIが2週間のプログラムを設計します。</div><div style={{marginBottom:20}}><div style={{fontSize:9,color:C.sand,letterSpacing:1.5,marginBottom:10}}>目標（複数可・必須）</div><div style={{display:'flex',flexWrap:'wrap',gap:6}}>{GOALS.map(g=><Chip key={g} label={g} active={goals.includes(g)} onClick={()=>toggle(goals,setGoals,g)}/>)}</div></div><div style={{marginBottom:20}}><div style={{fontSize:9,color:C.sand,letterSpacing:1.5,marginBottom:10}}>今の食生活（複数可）</div><div style={{display:'flex',flexWrap:'wrap',gap:6}}>{CURRENTS.map(c=><Chip key={c} label={c} active={currents.includes(c)} onClick={()=>toggle(currents,setCurrents,c)}/>)}</div></div><div style={{marginBottom:26}}><div style={{fontSize:9,color:C.sand,letterSpacing:1.5,marginBottom:10}}>希望・スタイル（複数可）</div><div style={{display:'flex',flexWrap:'wrap',gap:6}}>{VALUES2.map(v=><Chip key={v} label={v} active={vals.includes(v)} onClick={()=>toggle(vals,setVals,v)}/>)}</div></div><button onClick={generate} disabled={!canSubmit} style={{width:'100%',background:canSubmit?C.herb:C.parchment,border:'none',borderRadius:14,padding:15,fontFamily:'Georgia,serif',fontSize:14,letterSpacing:2,color:canSubmit?C.cream:C.sand,cursor:canSubmit?'pointer':'default'}}>プログラムを設計してもらう</button>{error&&<div style={{marginTop:14,padding:'10px 14px',background:'#fdecea',borderRadius:12,fontSize:11,color:'#8b2a1a'}}>{error}</div>}</>}{loading&&<div style={{textAlign:'center',padding:'60px 0',fontFamily:"Georgia,'Hiragino Mincho Pro',serif",color:C.herb,lineHeight:2.2}}>2週間のプログラムを<br/>設計しています...</div>}{program&&<div><div style={{background:C.herb,borderRadius:16,padding:'18px 18px 16px',marginBottom:16}}><div style={{fontSize:9,color:'rgba(250,246,238,0.65)',letterSpacing:2,marginBottom:6}}>あなたの2週間プログラム</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:17,color:C.cream,marginBottom:10,lineHeight:1.4}}>{program.title}</div><div style={{fontSize:10,color:'rgba(250,246,238,0.8)',lineHeight:1.7,marginBottom:14}}>{program.overview}</div><div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}><div style={{fontSize:9,color:'rgba(250,246,238,0.7)'}}>今日の進捗</div><div style={{fontSize:9,color:C.cream,fontWeight:500}}>{progress}%</div></div><div style={{background:'rgba(255,255,255,0.2)',borderRadius:10,height:6}}><div style={{background:C.cream,borderRadius:10,height:6,width:`${progress}%`,transition:'width 0.4s'}}/></div></div><div style={{display:'flex',gap:0,marginBottom:16,background:C.parchment,borderRadius:12,padding:3}}>{[1,2].map(w=><button key={w} onClick={()=>setActiveWeek(w)} style={{flex:1,background:activeWeek===w?C.cream:'none',border:'none',borderRadius:10,padding:'8px 0',fontSize:11,color:activeWeek===w?C.espresso:C.sand,cursor:'pointer',fontFamily:'system-ui,sans-serif'}}>Week {w}{activeWeek===w&&week?` — ${week.theme}`:''}</button>)}</div>{week&&<div><div style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:14,padding:'14px 16px',marginBottom:12}}><div style={{fontSize:9,color:C.sand,letterSpacing:1.5,marginBottom:8}}>今週の重点</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:C.espresso,lineHeight:1.8}}>{week.focus}</div></div><div style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:14,padding:'14px 16px',marginBottom:12}}><div style={{fontSize:9,color:C.sand,letterSpacing:1.5,marginBottom:12}}>毎日やること</div>{week.dailyTasks.map((task,i)=>{const key=`w${activeWeek}-${i}`;const done=!!checkedTasks[key];return <div key={i} onClick={()=>toggleTask(activeWeek,i)} style={{display:'flex',alignItems:'flex-start',gap:12,marginBottom:12,cursor:'pointer'}}><div style={{width:22,height:22,borderRadius:7,border:`2px solid ${done?C.moss:C.parchment}`,background:done?C.moss:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>{done&&<div style={{color:C.cream,fontSize:12,lineHeight:1,fontWeight:700}}>✓</div>}</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:done?C.sand:C.espresso,lineHeight:1.6,textDecoration:done?'line-through':'none'}}>{task}</div></div>})}</div><div style={{background:'#fdf7ee',border:'1px solid #e0c898',borderRadius:14,padding:'14px 16px',marginBottom:14}}><div style={{fontSize:9,color:C.clay,letterSpacing:1.5,marginBottom:8}}>今週の注目食材</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:C.espresso,lineHeight:1.8}}>{week.keyFood}</div></div></div>}<div style={{background:C.mist,border:'1px solid #b8d0a4',borderRadius:14,padding:'14px 16px',marginBottom:14}}><div style={{fontSize:9,color:C.moss,letterSpacing:1.5,marginBottom:10}}>14日後に確認すること</div>{program.checkpoints?.map((cp,i)=><div key={i} style={{display:'flex',gap:10,marginBottom:8}}><div style={{width:18,height:18,borderRadius:'50%',background:C.moss,display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,color:C.cream,fontFamily:'Georgia,serif',flexShrink:0,marginTop:1}}>{i+1}</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:C.espresso,lineHeight:1.7}}>{cp}</div></div>)}</div><div style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:14,padding:'14px 16px',marginBottom:14}}><div style={{fontSize:9,color:C.clay,letterSpacing:1.5,marginBottom:8}}>シェフ×AIからひとこと</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:13,color:C.espresso,lineHeight:1.8,fontStyle:'italic'}}>「{program.encouragement}」</div></div><button onClick={()=>{setProgram(null);setGoals([]);setCurrents([]);setVals([]);setCheckedTasks({})}} style={{width:'100%',background:'none',border:`1px solid ${C.parchment}`,borderRadius:14,padding:14,fontSize:12,color:C.sand,cursor:'pointer',fontFamily:'Georgia,serif'}}>条件を変えて再設計する</button></div>}</div></div>}

// ─── QA ───────────────────────────────────────────────────────
function QAScreen({onBack,onNavigate}){const [tab,setTab]=useState('chat');const [messages,setMessages]=useState([]);const [input,setInput]=useState('');const [loading,setLoading]=useState(false);const bottomRef=useRef(null);useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:'smooth'})},[messages,loading]);const sendMessage=async(text)=>{if(!text.trim()||loading)return;const userMsg={role:'user',text,ts:Date.now()};const next=[...messages,userMsg];setMessages(next);setInput('');setLoading(true);try{const res=await callClaude(QA_PROMPT,text,800);const aiMsg={role:'ai',...res,ts:Date.now()};setMessages([...next,aiMsg])}catch{setMessages([...next,{role:'ai',answer:'申し訳ありません、回答の取得に失敗しました。',ts:Date.now()}])}finally{setLoading(false)}};const FCOLORS={checker:C.moss,recipe:C.clay,nutrition:C.sand,program:C.herb};const FLABELS={checker:'添加物チェッカー',recipe:'惣菜レシピ提案',nutrition:'食材の栄養解説',program:'マイプログラム'};return <div style={{background:C.linen,minHeight:'100vh',fontFamily:"system-ui,'Hiragino Sans',sans-serif",display:'flex',flexDirection:'column'}}><AppBar title="Q&A 相談" onBack={onBack} rightEl={<button onClick={()=>setTab(tab==='chat'?'chef':'chat')} style={{background:tab==='chef'?'rgba(255,255,255,0.25)':'rgba(255,255,255,0.12)',border:'none',borderRadius:10,padding:'4px 10px',fontSize:9,color:C.cream,cursor:'pointer'}}>{tab==='chat'?'シェフQ&A':'AI相談'}</button>}/>{tab==='chat'&&<div style={{flex:1,display:'flex',flexDirection:'column'}}><div style={{flex:1,padding:'16px 16px 0',overflowY:'auto'}}>{messages.length===0&&!loading&&<div style={{marginBottom:20}}><div style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:16,padding:'16px 16px 14px',marginBottom:14}}><div style={{display:'flex',gap:10,alignItems:'flex-start',marginBottom:10}}><Logo size={28} color={C.moss}/><div><div style={{fontSize:10,fontWeight:500,color:C.espresso,marginBottom:2}}>SOZAI TABLE AI</div><div style={{display:'flex',gap:4}}><span style={{fontSize:7,background:C.herb,color:C.cream,padding:'2px 6px',borderRadius:8}}>即時回答</span><span style={{fontSize:7,background:C.clay,color:C.cream,padding:'2px 6px',borderRadius:8}}>月1シェフ確認</span></div></div></div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:C.espresso,lineHeight:1.8,marginBottom:12}}>食・栄養・調味料・添加物について、なんでも聞いてください。</div><div style={{display:'flex',gap:7,alignItems:'center'}}><input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendMessage(input)} placeholder="気になる食材や調味料を聞く..." style={{flex:1,background:C.linen,border:`1.5px solid ${C.parchment}`,borderRadius:12,padding:'9px 12px',fontSize:12,color:C.espresso,outline:'none',fontFamily:"system-ui,'Hiragino Sans',sans-serif"}}/><button onClick={()=>sendMessage(input)} disabled={!input.trim()} style={{width:36,height:36,borderRadius:'50%',background:input.trim()?C.moss:C.parchment,border:'none',cursor:input.trim()?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8L14 2L10 8L14 14L2 8Z" fill="#faf6ee" strokeLinejoin="round"/></svg></button></div></div><div style={{fontSize:9,color:C.sand,letterSpacing:1.5,marginBottom:10}}>よく聞かれる質問</div><div style={{display:'flex',flexWrap:'wrap',gap:6}}>{QUICK_QUESTIONS.map(q=><span key={q} onClick={()=>sendMessage(q)} style={{fontSize:10,color:C.moss,background:C.mist,border:'1px solid #b8d0a4',borderRadius:20,padding:'5px 12px',cursor:'pointer',display:'inline-block'}}>{q}</span>)}</div></div>}{messages.map((msg,i)=><div key={i} style={{marginBottom:18}}>{msg.role==='user'&&<div style={{display:'flex',justifyContent:'flex-end'}}><div style={{background:C.moss,borderRadius:'16px 16px 4px 16px',padding:'10px 14px',maxWidth:'82%',fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:13,color:C.cream,lineHeight:1.7}}>{msg.text}</div></div>}{msg.role==='ai'&&<div style={{display:'flex',gap:9,alignItems:'flex-start'}}><div style={{width:28,height:28,borderRadius:'50%',background:C.herb,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Logo size={18} color={C.cream}/></div><div style={{flex:1}}><div style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:'4px 16px 16px 16px',padding:'12px 14px',marginBottom:msg.tips?7:0}}><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:C.espresso,lineHeight:1.85,whiteSpace:'pre-line'}}>{msg.answer}</div></div>{msg.tips&&<div style={{background:C.mist,border:'1px solid #b8d0a4',borderRadius:12,padding:'8px 12px',marginBottom:7}}><div style={{fontSize:8,color:C.moss,letterSpacing:1,marginBottom:3}}>実践のヒント</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:C.espresso,lineHeight:1.7}}>{msg.tips}</div></div>}{msg.relatedFeature&&<button onClick={()=>onNavigate(msg.relatedFeature.key)} style={{display:'flex',alignItems:'center',gap:8,background:'none',border:`1px solid ${FCOLORS[msg.relatedFeature.key]||C.parchment}`,borderRadius:12,padding:'7px 12px',cursor:'pointer',width:'100%',marginBottom:7}}><div style={{width:8,height:8,borderRadius:'50%',background:FCOLORS[msg.relatedFeature.key]||C.sand,flexShrink:0}}/><div style={{textAlign:'left'}}><div style={{fontSize:9,color:FCOLORS[msg.relatedFeature.key]||C.sand,fontWeight:500}}>{FLABELS[msg.relatedFeature.key]||msg.relatedFeature.label}を使ってみる →</div><div style={{fontSize:8,color:C.sand,marginTop:1}}>{msg.relatedFeature.reason}</div></div></button>}</div></div>}</div>)}{loading&&<div style={{display:'flex',gap:9,alignItems:'flex-start',marginBottom:16}}><div style={{width:28,height:28,borderRadius:'50%',background:C.herb,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Logo size={18} color={C.cream}/></div><div style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:'4px 16px 16px 16px',padding:'12px 14px'}}><div style={{display:'flex',gap:5,alignItems:'center'}}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:'50%',background:C.herb,opacity:0.7}}/>)}</div></div></div>}<div ref={bottomRef}/></div>{messages.length>0&&<div style={{padding:'10px 14px 18px',borderTop:`1px solid ${C.parchment}`,background:C.linen}}><div style={{display:'flex',gap:7,alignItems:'flex-end'}}><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage(input)}}} placeholder="続けて聞く..." rows={1} style={{flex:1,background:C.cream,border:`1.5px solid ${C.parchment}`,borderRadius:14,padding:'9px 13px',fontSize:13,color:C.espresso,fontFamily:"system-ui,'Hiragino Sans',sans-serif",lineHeight:1.5,resize:'none',outline:'none',boxSizing:'border-box'}}/><button onClick={()=>sendMessage(input)} disabled={!input.trim()||loading} style={{width:40,height:40,borderRadius:'50%',background:input.trim()&&!loading?C.moss:C.parchment,border:'none',cursor:input.trim()&&!loading?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8L14 2L10 8L14 14L2 8Z" fill="#faf6ee" strokeLinejoin="round"/></svg></button></div></div>}</div>}{tab==='chef'&&<div style={{padding:'16px 16px 32px'}}><div style={{background:C.clay,borderRadius:16,padding:'14px 18px',marginBottom:20,display:'flex',gap:12}}><div style={{width:36,height:36,borderRadius:'50%',background:'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:C.cream,fontFamily:'Georgia,serif',flexShrink:0}}>CF</div><div><div style={{fontSize:10,color:'rgba(250,246,238,0.7)',letterSpacing:1,marginBottom:4}}>月1回 シェフが厳選回答</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:13,color:C.cream,lineHeight:1.6}}>毎月寄せられた質問の中から、シェフが特に大切なものを選んで詳しくコメントします。</div></div></div><button onClick={()=>setTab('chat')} style={{background:C.moss,border:'none',borderRadius:10,padding:'8px 16px',fontSize:10,color:C.cream,cursor:'pointer',fontFamily:'Georgia,serif',marginBottom:20}}>AI相談を開く →</button></div>}<style>{`@keyframes pulse{0%,100%{opacity:0.4;transform:scale(0.85)}50%{opacity:1;transform:scale(1)}}`}</style></div>}

// ─── COLUMN ───────────────────────────────────────────────────
function ColumnScreen({onBack}){const [view,setView]=useState('list');const [selected,setSelected]=useState(null);const [openQA,setOpenQA]=useState(null);const current=COLUMNS[0];const ColumnBody=({block})=>{switch(block.type){case 'lead':return <div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:14,color:C.espresso,lineHeight:1.9,borderLeft:`3px solid ${C.clay}`,paddingLeft:14,margin:'0 0 20px'}}>{block.text}</div>;case 'heading':return <div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:14,color:C.moss,lineHeight:1.6,margin:'24px 0 12px',borderBottom:`1px solid ${C.parchment}`,paddingBottom:8}}>{block.text}</div>;case 'body':return <div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:13,color:C.espresso,lineHeight:1.9,margin:'0 0 16px'}}>{block.text}</div>;case 'highlight':return <div style={{background:'#fdf7ee',border:'1px solid #e0c898',borderRadius:14,padding:'14px 16px',margin:'16px 0 20px'}}><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:13,color:C.clay,lineHeight:1.85,fontStyle:'italic'}}>「{block.text}」</div></div>;case 'recipe_tip':return <div style={{background:C.mist,border:'1px solid #b8d0a4',borderRadius:14,padding:'14px 16px',margin:'16px 0 20px'}}><div style={{fontSize:9,color:C.moss,letterSpacing:1.5,marginBottom:8}}>{block.title}</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:13,color:C.espresso,lineHeight:1.85}}>{block.text}</div></div>;case 'closing':return <div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:14,color:C.herb,lineHeight:1.9,margin:'24px 0 0',textAlign:'center',fontStyle:'italic'}}>{block.text}</div>;default:return null}};if(view==='detail'&&selected)return(<div style={{background:C.linen,minHeight:'100vh',fontFamily:"system-ui,'Hiragino Sans',sans-serif"}}><AppBar title="シェフのコラム" onBack={()=>setView('list')}/><div style={{padding:'0 0 32px'}}><div style={{background:C.moss,padding:'24px 20px 28px'}}><div style={{display:'flex',gap:8,marginBottom:14}}><span style={{fontSize:8,background:C.clay,color:C.cream,padding:'3px 10px',borderRadius:20}}>{selected.tag}</span><span style={{fontSize:8,color:'rgba(250,246,238,0.6)'}}>{selected.readTime}</span></div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:20,color:C.cream,lineHeight:1.5,marginBottom:8,fontWeight:'normal'}}>{selected.title}</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:'rgba(250,246,238,0.7)',marginBottom:16,fontStyle:'italic'}}>{selected.subtitle}</div><div style={{display:'flex',alignItems:'center',gap:10}}><div style={{width:34,height:34,borderRadius:'50%',background:C.clay,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:C.cream,fontFamily:'Georgia,serif',flexShrink:0}}>CF</div><div><div style={{fontSize:10,color:C.cream,fontWeight:500}}>現役シェフ</div><div style={{fontSize:8,color:'rgba(250,246,238,0.6)',marginTop:1}}>{selected.date}</div></div></div></div><div style={{background:C.moss,height:24,borderRadius:'0 0 50% 50%/0 0 24px 24px',marginBottom:8}}/><div style={{padding:'8px 20px 0'}}>{selected.body.map((b,i)=><ColumnBody key={i} block={b}/>)}</div>{selected.qa?.length>0&&<div style={{margin:'28px 16px 0'}}><div style={{fontSize:8,color:C.sand,letterSpacing:2,marginBottom:14}}>このコラムへのQ&A</div>{selected.qa.map((item,i)=><div key={i} style={{background:'#fdf7ee',border:'1px solid #e0c898',borderRadius:14,marginBottom:10,overflow:'hidden'}}><div onClick={()=>setOpenQA(openQA===i?null:i)} style={{padding:'12px 16px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}><div style={{display:'flex',gap:8,flex:1}}><span style={{fontSize:9,background:C.clay,color:C.cream,padding:'2px 7px',borderRadius:8,flexShrink:0,marginTop:2}}>Q</span><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:C.espresso,lineHeight:1.6}}>{item.q}</div></div><span style={{fontSize:10,color:C.sand,flexShrink:0}}>{openQA===i?'▲':'▼'}</span></div>{openQA===i&&<div style={{borderTop:'1px solid #e0c898',padding:'12px 16px',background:C.cream}}><div style={{display:'flex',gap:8}}><span style={{fontSize:9,background:C.moss,color:C.cream,padding:'2px 7px',borderRadius:8,flexShrink:0,marginTop:2}}>A</span><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:C.espresso,lineHeight:1.8}}>{item.a}</div></div></div>}</div>)}</div>}<div style={{margin:'24px 16px 0'}}><button onClick={()=>setView('list')} style={{width:'100%',background:'none',border:`1px solid ${C.parchment}`,borderRadius:14,padding:13,fontSize:11,color:C.sand,cursor:'pointer',fontFamily:'Georgia,serif'}}>コラム一覧に戻る</button></div></div></div>);return(<div style={{background:C.linen,minHeight:'100vh',fontFamily:"system-ui,'Hiragino Sans',sans-serif"}}><AppBar title="シェフのコラム" onBack={onBack}/><div style={{padding:'16px 16px 32px'}}><div style={{marginBottom:20}}><div style={{fontSize:8,color:C.sand,letterSpacing:2,marginBottom:10}}>今月のコラム</div><div onClick={()=>{setSelected(current);setView('detail');setOpenQA(null)}} style={{background:C.cream,border:`1.5px solid ${C.moss}`,borderRadius:20,overflow:'hidden',cursor:'pointer'}}><div style={{background:C.moss,padding:'20px 20px 18px'}}><div style={{display:'flex',gap:8,marginBottom:10}}><span style={{fontSize:8,background:C.clay,color:C.cream,padding:'3px 10px',borderRadius:20}}>{current.tag}</span><span style={{fontSize:8,color:'rgba(250,246,238,0.65)'}}>{current.readTime}</span></div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:17,color:C.cream,lineHeight:1.5,marginBottom:6,fontWeight:'normal'}}>{current.title}</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:'rgba(250,246,238,0.7)',fontStyle:'italic'}}>{current.subtitle}</div></div><div style={{padding:'14px 20px 16px'}}><div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}><div style={{width:32,height:32,borderRadius:'50%',background:C.clay,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:C.cream,fontFamily:'Georgia,serif',flexShrink:0}}>CF</div><div><div style={{fontSize:10,fontWeight:500,color:C.espresso}}>現役シェフ</div><div style={{fontSize:8,color:C.sand,marginTop:1}}>{current.date}</div></div></div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:'#6a7860',lineHeight:1.7,marginBottom:12}}>{current.body.find(b=>b.type==='lead')?.text?.slice(0,60)}...</div><div style={{fontSize:10,color:C.moss,fontWeight:500}}>続きを読む →</div></div></div></div><div style={{fontSize:8,color:C.sand,letterSpacing:2,marginBottom:12}}>バックナンバー</div>{COLUMNS.slice(1).map((col,i)=><div key={i} onClick={()=>{setSelected(col);setView('detail');setOpenQA(null)}} style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:16,padding:'14px 16px',marginBottom:10,cursor:'pointer'}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><div style={{flex:1}}><div style={{display:'flex',gap:6,marginBottom:6}}><span style={{fontSize:8,background:C.mist,color:C.moss,border:'1px solid #b8d0a4',borderRadius:8,padding:'2px 7px'}}>{col.tag}</span><span style={{fontSize:8,color:C.sand}}>{col.month}</span></div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:14,color:C.espresso,lineHeight:1.4,marginBottom:4}}>{col.title}</div></div><span style={{fontSize:10,color:C.parchment,flexShrink:0,marginLeft:8,marginTop:4}}>→</span></div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:'#8a7860',lineHeight:1.6}}>{col.body.find(b=>b.type==='lead')?.text?.slice(0,50)}...</div></div>)}</div></div>)}

// ─── SAVED ────────────────────────────────────────────────────
function SavedScreen({onBack,savedRecipes,savedNutrition,onDelete}){const [tab,setTab]=useState('recipe');const [expandedR,setExpandedR]=useState(null);const [expandedN,setExpandedN]=useState(null);return <div style={{background:C.linen,minHeight:'100vh',fontFamily:"system-ui,'Hiragino Sans',sans-serif"}}><AppBar title="保存リスト" onBack={onBack}/><div style={{padding:'16px 16px 0'}}><div style={{display:'flex',marginBottom:20,background:C.parchment,borderRadius:12,padding:3}}>{[['recipe',`レシピ (${savedRecipes.length})`],['nutrition',`食材 (${savedNutrition.length})`]].map(([key,label])=><button key={key} onClick={()=>setTab(key)} style={{flex:1,background:tab===key?C.cream:'none',border:'none',borderRadius:10,padding:'8px 0',fontSize:11,color:tab===key?C.espresso:C.sand,cursor:'pointer'}}>{label}</button>)}</div>{tab==='recipe'&&(savedRecipes.length===0?<div style={{textAlign:'center',padding:'48px 0',fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:C.sand,lineHeight:2}}>まだ保存したレシピはありません。</div>:savedRecipes.map((r,i)=>{const catC=CATEGORY_COLOR[r.category]||{bg:'#f5f5f5',text:'#555'};const isOpen=expandedR===i;return <div key={i} style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:16,marginBottom:12,overflow:'hidden'}}><div style={{padding:'14px 16px',cursor:'pointer'}} onClick={()=>setExpandedR(isOpen?null:i)}><div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}><div style={{display:'flex',alignItems:'center',gap:8,flex:1}}><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:14,color:C.espresso}}>{r.name}</div><span style={{fontSize:8,background:catC.bg,color:catC.text,padding:'2px 8px',borderRadius:10}}>{r.category}</span></div><button onClick={e=>{e.stopPropagation();onDelete('recipe',r.dbId)}} style={{background:'none',border:'none',fontSize:14,color:C.parchment,cursor:'pointer',padding:'0 0 0 8px'}}>×</button></div><div style={{fontSize:10,color:C.herb,lineHeight:1.5,marginBottom:6}}>{r.why}</div><div style={{display:'flex',justifyContent:'space-between'}}><div style={{display:'flex',flexWrap:'wrap',gap:4}}>{r.mainIngredients?.slice(0,3).map((ing,j)=><span key={j} style={{fontSize:8,background:C.mist,color:C.moss,border:'1px solid #b8d0a4',borderRadius:10,padding:'2px 6px'}}>{ing}</span>)}</div><span style={{fontSize:8,color:C.sand}}>{fmtDate(r.savedAt)}</span></div></div>{isOpen&&<div style={{borderTop:`1px solid ${C.parchment}`,padding:'14px 16px',background:'#fdfaf5'}}><div style={{marginBottom:12}}><div style={{fontSize:9,color:C.sand,letterSpacing:1.5,marginBottom:6}}>栄養ポイント</div><div style={{fontSize:11,color:C.espresso,background:C.mist,border:'1px solid #b8d0a4',borderRadius:10,padding:'8px 12px',lineHeight:1.6}}>{r.nutrition}</div></div><div><div style={{fontSize:9,color:C.sand,letterSpacing:1.5,marginBottom:6}}>作り方のポイント</div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:C.espresso,lineHeight:1.8}}>{r.method}</div></div></div>}<div onClick={()=>setExpandedR(isOpen?null:i)} style={{textAlign:'center',padding:'8px',borderTop:`1px solid ${C.parchment}`,fontSize:9,color:C.herb,cursor:'pointer'}}>{isOpen?'▲ 閉じる':'▼ 詳細を見る'}</div></div>}))}{tab==='nutrition'&&(savedNutrition.length===0?<div style={{textAlign:'center',padding:'48px 0',fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:C.sand,lineHeight:2}}>まだ保存した食材はありません。</div>:savedNutrition.map((s,i)=>{const isOpen=expandedN===i;const d=s.detail;return <div key={i} style={{background:C.cream,border:`1px solid ${C.parchment}`,borderRadius:16,marginBottom:12,overflow:'hidden'}}><div style={{background:s.ingredient?.accent||C.moss,padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setExpandedN(isOpen?null:i)}><div><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:15,color:C.cream}}>{s.ingredient?.name}</div><div style={{fontSize:8,color:'rgba(250,246,238,0.7)',marginTop:2}}>{s.ingredient?.season} · {fmtDate(s.savedAt)}</div></div><button onClick={e=>{e.stopPropagation();onDelete('nutrition',s.dbId)}} style={{background:'rgba(255,255,255,0.2)',border:'none',borderRadius:8,padding:'4px 8px',fontSize:12,color:C.cream,cursor:'pointer'}}>×</button></div>{isOpen&&d&&<div style={{padding:'16px'}}><div style={{fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:12,color:C.espresso,lineHeight:1.8,marginBottom:14,padding:'12px 14px',background:C.linen,borderRadius:12}}>{d.overview}</div>{d.nutrients?.map((n,j)=><div key={j} style={{display:'flex',gap:10,marginBottom:8}}><div style={{width:8,height:8,borderRadius:'50%',background:s.ingredient?.accent||C.moss,flexShrink:0,marginTop:4}}/><div><div style={{fontSize:11,fontWeight:500,color:C.espresso,marginBottom:2}}>{n.name}</div><div style={{fontSize:10,color:'#6a7860',lineHeight:1.5}}>{n.effect}</div></div></div>)}<div style={{background:C.mist,border:'1px solid #b8d0a4',borderRadius:12,padding:'12px 14px',fontFamily:"Georgia,'Hiragino Mincho Pro',serif",fontSize:11,color:C.espresso,lineHeight:1.8,marginBottom:14}}>{d.cooking}</div><div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:14}}>{d.pairing?.map((p,j)=><span key={j} style={{fontSize:10,background:C.cream,border:`1px solid ${s.ingredient?.accent||C.moss}`,color:s.ingredient?.accent||C.moss,padding:'4px 12px',borderRadius:20}}>{p}</span>)}</div></div>}<div onClick={()=>setExpandedN(isOpen?null:i)} style={{textAlign:'center',padding:'8px',borderTop:`1px solid ${C.parchment}`,fontSize:9,color:C.herb,cursor:'pointer'}}>{isOpen?'▲ 閉じる':'▼ 詳細を見る'}</div></div>}))}<div style={{height:32}}/></div></div>}
