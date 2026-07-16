// client/src/pages/FieldGuide.jsx
// Help Guide — bilingual checklist + reference tabs for the field team

import { useState } from 'react';

const BLUE = '#1B3A6B';
const ORANGE = '#E07B2A';
const GREEN = '#2E7D32';
const RED = '#C62828';
const YELLOW = '#F9A825';

/* ─────────────────────────────────────────────
   CHECKLIST SECTIONS
───────────────────────────────────────────── */
const sections = [
  {
    title: 'Before You Start / Antes de Começar',
    icon: '📋',
    items: [
      { en: 'Customer full name', pt: 'Nome completo do cliente', required: true },
      { en: 'Customer email address', pt: 'Email do cliente', required: true },
      { en: 'Customer phone number', pt: 'Telefone do cliente', required: true },
      {
        en: 'Full project address (street, city, zip)',
        pt: 'Endereço completo da obra (rua, cidade, CEP)',
        required: true,
      },
      {
        en: 'Is this a new build or renovation?',
        pt: 'É construção nova ou reforma?',
        required: true,
      },
      {
        en: 'Total square footage (each floor separately)',
        pt: 'Metragem total (por andar separadamente)',
        required: true,
      },
      { en: 'Number of stories / floors', pt: 'Número de andares', required: true },
      {
        en: 'Is the town a Stretch Energy Code town?',
        pt: 'A cidade segue o Stretch Energy Code?',
        required: true,
        warning: true,
      },
    ],
  },
  {
    title: 'Site & Foundation / Terreno e Fundação',
    icon: '🏗️',
    items: [
      {
        en: 'Is there an existing structure to demo?',
        pt: 'Há alguma estrutura existente para demolir?',
        required: false,
      },
      {
        en: 'Foundation type: slab / crawlspace / full basement',
        pt: 'Tipo de fundação: laje / semi-porão / porão completo',
        required: true,
      },
      {
        en: 'Will customer handle sitework themselves?',
        pt: 'O cliente vai fazer a terraplanagem?',
        required: true,
      },
      {
        en: 'Well and septic needed? (DO NOT include unless asked)',
        pt: 'Precisa de poço e fossa? (NÃO incluir sem o cliente pedir)',
        required: true,
        warning: true,
      },
      {
        en: 'Electrical service: underground or overhead?',
        pt: 'Serviço elétrico: subterrâneo ou aéreo?',
        required: true,
      },
    ],
  },
  {
    title: 'Framing / Estrutura',
    icon: '🔨',
    items: [
      {
        en: 'Exterior wall framing: 2×4 or 2×6? (Stretch Code = 2×6 required)',
        pt: 'Paredes externas: 2×4 ou 2×6? (Stretch Code = 2×6 obrigatório)',
        required: true,
        warning: true,
      },
      {
        en: 'Floor system: TJI engineered / lumber / LVL',
        pt: 'Sistema de piso: TJI / madeira / LVL',
        required: true,
      },
      {
        en: 'Roof framing: pre-fab trusses or stick frame (rafters)',
        pt: 'Telhado: treliças pré-fabricadas ou ripas',
        required: true,
      },
      {
        en: 'Roof pitch — e.g. 4:12, 6:12, 8:12',
        pt: 'Inclinação do telhado — ex: 4:12, 6:12, 8:12',
        required: true,
        warning: true,
      },
      {
        en: 'Cathedral / vaulted ceilings in any room?',
        pt: 'Teto catedral em algum cômodo?',
        required: true,
      },
      { en: 'Deck: yes/no — size if yes', pt: 'Deck: sim/não — tamanho se sim', required: false },
      { en: 'Fireplace / chimney: yes/no', pt: 'Lareira / chaminé: sim/não', required: false },
      { en: 'Garage bays: 1, 2, or 3?', pt: 'Vagas de garagem: 1, 2 ou 3?', required: false },
    ],
  },
  {
    title: 'Roof & Exterior / Telhado e Exterior',
    icon: '🏠',
    items: [
      {
        en: 'Roofing: standing seam metal / corrugated metal / architectural shingles',
        pt: 'Telhado: metal seam / metal corrugado / telha asfáltica',
        required: true,
      },
      {
        en: 'Siding: board & batten / vinyl / fiber cement / other',
        pt: 'Revestimento: board & batten / vinyl / fibrocimento / outro',
        required: true,
      },
      {
        en: 'Number of windows + size (e.g. 12 windows, 3040)',
        pt: 'Número de janelas + tamanho (ex: 12 janelas, 3040)',
        required: true,
      },
      {
        en: 'Number of exterior doors (including slider)',
        pt: 'Número de portas externas (incluindo slider)',
        required: true,
      },
      {
        en: 'Garage door size and quantity',
        pt: 'Tamanho e quantidade de portas de garagem',
        required: false,
      },
    ],
  },
  {
    title: 'Mechanical, Electrical & Plumbing / MEP',
    icon: '⚡',
    items: [
      {
        en: 'HVAC: mini-splits / forced air / forced hot water (boiler) / other',
        pt: 'HVAC: mini-splits / ar forçado / água quente forçada / outro',
        required: true,
      },
      {
        en: 'Number of mini-split heads (if applicable)',
        pt: 'Número de cabeças de mini-split (se aplicável)',
        required: false,
      },
      { en: 'Number of full bathrooms', pt: 'Número de banheiros completos', required: true },
      { en: 'Number of half baths', pt: 'Número de lavabos', required: true },
      { en: 'Kitchen: yes/no', pt: 'Cozinha: sim/não', required: true },
      { en: 'Laundry hookup needed?', pt: 'Ponto de lavanderia necessário?', required: false },
      {
        en: 'Water heater: tank / tankless / heat pump water heater',
        pt: 'Aquecedor: reservatório / instantâneo / heat pump',
        required: false,
      },
    ],
  },
  {
    title: 'Insulation & Drywall / Isolamento e Drywall',
    icon: '🧱',
    items: [
      {
        en: 'Insulation: fiberglass batt / spray foam / dense pack cellulose',
        pt: 'Isolamento: lã de vidro / spray foam / celulose',
        required: true,
      },
      {
        en: 'Garage drywall: yes/no (not required for CO but required for fire separation)',
        pt: 'Drywall na garagem: sim/não (não obrigatório para CO)',
        required: true,
      },
      {
        en: 'Wall finish: blueboard+plaster / standard drywall / lightweight drywall',
        pt: 'Acabamento: blueboard+gesso / drywall padrão / drywall leve',
        required: true,
      },
    ],
  },
  {
    title: 'Finishes / Acabamentos',
    icon: '✨',
    items: [
      {
        en: 'Flooring: LVP / hardwood / carpet / ceramic tile / other',
        pt: 'Piso: LVP / madeira / carpete / cerâmica / outro',
        required: true,
      },
      {
        en: 'Kitchen cabinet style and grade (stock / semi-custom / custom)',
        pt: 'Armários de cozinha: estilo e qualidade',
        required: false,
      },
      {
        en: 'Countertop: quartz / granite / laminate / other',
        pt: 'Bancada: quartzo / granito / laminado / outro',
        required: false,
      },
      {
        en: 'Paint: PB painting or customer doing it themselves?',
        pt: 'Pintura: PB pinta ou cliente pinta?',
        required: true,
      },
      {
        en: 'Appliances: customer supplying their own?',
        pt: 'Eletrodomésticos: o cliente vai fornecer?',
        required: true,
      },
    ],
  },
  {
    title: '⚠️ Never Forget / Nunca Esqueça',
    icon: '🚨',
    items: [
      {
        en: 'ALWAYS get the roof pitch — missing pitch causes estimate delays',
        pt: 'SEMPRE obtenha a inclinação do telhado',
        required: true,
        warning: true,
      },
      {
        en: 'ALWAYS check if the town uses Stretch Energy Code (see reference tab)',
        pt: 'SEMPRE verifique se a cidade usa Stretch Energy Code',
        required: true,
        warning: true,
      },
      {
        en: 'ALWAYS note sq footage per floor separately, not just total',
        pt: 'SEMPRE anote metragem por andar separadamente',
        required: true,
        warning: true,
      },
      {
        en: 'NEVER include well, septic, underground electric, or appliances unless explicitly requested',
        pt: 'NUNCA inclua poço, fossa, elétrica subterrânea ou eletrodomésticos sem pedir',
        required: true,
        warning: true,
      },
      {
        en: 'NEVER give a verbal price on site — always go through the system',
        pt: 'NUNCA dê preço verbal no local — sempre use o sistema',
        required: true,
        warning: true,
      },
    ],
  },
];

/* ─────────────────────────────────────────────
   STRETCH CODE TOWNS (MA)
───────────────────────────────────────────── */
const STRETCH_TOWNS = [
  'Acton',
  'Amherst',
  'Ashby',
  'Ashland',
  'Ayer',
  'Bedford',
  'Belmont',
  'Bolton',
  'Boxborough',
  'Boylston',
  'Cambridge',
  'Canton',
  'Carlisle',
  'Chelmsford',
  'Concord',
  'Easton',
  'Fitchburg',
  'Framingham',
  'Groton',
  'Harvard',
  'Hudson',
  'Lancaster',
  'Leominster',
  'Lexington',
  'Lincoln',
  'Littleton',
  'Lunenburg',
  'Maynard',
  'Medfield',
  'Medway',
  'Milford',
  'Millis',
  'Natick',
  'Newton',
  'Northborough',
  'Pepperell',
  'Shirley',
  'Stow',
  'Sudbury',
  'Townsend',
  'Waltham',
  'Wayland',
  'Westborough',
  'Westminster',
  'Wilmington',
  'Worcester',
].sort();

/* ─────────────────────────────────────────────
   PROCESS FLOW STEPS
───────────────────────────────────────────── */
const PROCESS = [
  {
    step: '1',
    icon: '📞',
    title: 'Initial Contact',
    body: 'Customer calls, texts, or emails. Collect name, phone, email, and project address. Ask if this is a new build or renovation.',
  },
  {
    step: '2',
    icon: '🏗️',
    title: 'Site Visit / Scope Meeting',
    body: 'Go to the site. Use the Checklist tab to make sure you capture every required question. Take photos. Get the roof pitch and sq footage per floor.',
  },
  {
    step: '3',
    icon: '📊',
    title: 'Create Job in System',
    body: 'Go to Dashboard → New Job. Enter all customer info and project details. System assigns a PB number automatically.',
  },
  {
    step: '4',
    icon: '🤖',
    title: 'Generate Estimate with AI',
    body: 'Open the job → Ask the AI to build the estimate. Describe the scope in plain English. AI uses your prices, markup chain, and license number.',
  },
  {
    step: '5',
    icon: '📄',
    title: 'Review & Export PDF',
    body: "Review every line item. Adjust any quantities that don't match the scope. Export the estimate PDF from the job page.",
  },
  {
    step: '6',
    icon: '✍️',
    title: 'Send Contract for Signature',
    body: 'Generate the contract from the estimate. Send it to the customer via email directly from the system.',
  },
  {
    step: '7',
    icon: '💰',
    title: 'Track Payments',
    body: 'Log deposits and progress payments in the Payments tab. System keeps running balance per job.',
  },
  {
    step: '8',
    icon: '✅',
    title: 'Close Out Job',
    body: 'Mark job complete when punch list is done. Archive it once final payment is received.',
  },
];

/* ─────────────────────────────────────────────
   QUICK REFERENCE — WHAT TO EXCLUDE
───────────────────────────────────────────── */
const EXCLUSIONS = [
  {
    item: 'Well drilling & pump',
    note: 'Subcontracted separately — never include unless customer specifically adds it',
  },
  { item: 'Septic design & install', note: 'Engineer + sub — always excluded by default' },
  { item: 'Underground electric service', note: 'Utility work — excluded unless customer asks' },
  {
    item: 'Appliances (range, fridge, dishwasher)',
    note: 'Customer supplied — note it in the contract as an exclusion',
  },
  {
    item: 'Permits & permit fees',
    note: 'Listed as customer responsibility unless agreed otherwise',
  },
  { item: 'Survey / lot stakeout', note: 'Customer provides or hires separately' },
  { item: 'Landscaping & loam/seeding', note: 'Excluded unless explicitly in scope' },
  { item: 'Dumpster (customer side)', note: 'PB charges separately per job' },
  { item: 'Temporary power / generator', note: 'Noted separately — not in base estimate' },
  {
    item: 'Building plans / engineer',
    note: 'Customer provides stamped plans before we pull permit',
  },
];

/* ─────────────────────────────────────────────
   MARKUP CHAIN REFERENCE
───────────────────────────────────────────── */
const MARKUP_ROWS = [
  { label: 'Raw material + labor cost', example: '$10,000', note: 'Your actual cost' },
  { label: '+ Sub O&P (15%)', example: '$11,500', note: 'If using a subcontractor' },
  { label: '+ GC O&P (25%)', example: '$14,375', note: "PB's markup on the sub" },
  { label: '+ Contingency (10%)', example: '$15,813', note: 'Buffer for unknowns' },
  { label: 'Total multiplier ≈ 1.58×', example: '', note: 'Auto-applied by AI' },
];

/* ─────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────── */
const TABS = ['Checklist', 'Process Flow', 'Stretch Code', 'Exclusions', 'Markup Chain', 'Payments & Invoicing'];

/* ─────────────────────────────────────────────
   PAYMENTS & INVOICING GUIDE
───────────────────────────────────────────── */
const INVOICE_TYPES = [
  {
    type: 'Deposit Invoice (DEP)',
    color: '#1B3A6B',
    when: 'Auto-generated when contract is signed',
    amount: '33% of total contract value',
    note: 'Must be collected before any work begins.',
  },
  {
    type: 'Progress Invoice',
    color: '#E07B2A',
    when: 'Created manually as work milestones are hit',
    amount: 'Negotiated per milestone (e.g. Foundation Complete)',
    note: 'Typical draw schedule: 33% deposit / 33% mid-job / 34% final.',
  },
  {
    type: 'Final Invoice',
    color: '#2E7D32',
    when: 'Last payment before job closeout',
    amount: 'Remaining balance after all prior draws',
    note: 'Collect before marking the job complete.',
  },
  {
    type: 'Balance Due (auto)',
    color: '#7B1FA2',
    when: 'Auto-generated when a partial payment is recorded',
    amount: 'Remaining balance = invoice amount − payment received',
    note: 'Draft only — review before sending to customer.',
  },
];

const PAYMENT_STEPS = [
  {
    step: '1',
    icon: '💵',
    title: 'Go to the Job → Payments tab',
    body: 'Always record payments inside the specific job, not from the global Payments page.',
  },
  {
    step: '2',
    icon: '➕',
    title: 'Click "Add Payment" under Checks Received',
    body: 'Enter the exact amount on the check, the date received, check number, and payment type (Deposit / Progress / Final).',
  },
  {
    step: '3',
    icon: '🔗',
    title: 'Select the matching invoice',
    body: 'Pick the invoice this payment is for from the dropdown. The system will auto-link and update the invoice status.',
  },
  {
    step: '4',
    icon: '✅',
    title: 'Save — system does the rest',
    body: 'Full payment: invoice marked Paid automatically. Partial payment: invoice stays open, balance-due draft created for the remainder.',
  },
];

const PAYMENT_RULES = [
  {
    icon: '⚠️',
    color: '#C62828',
    rule: 'Never click "Mark Paid" on an invoice directly',
    detail:
      'Use the Payments tab to record the check instead. "Mark Paid" skips the payment record and breaks the AR ledger.',
  },
  {
    icon: '💡',
    color: '#E07B2A',
    rule: 'Enter the actual check amount — even if partial',
    detail:
      'If the customer sends $13,000 on a $30,000 invoice, record $13,000. The system auto-generates the balance-due for $17,000.',
  },
  {
    icon: '🔢',
    color: '#1B3A6B',
    rule: 'Always enter the check number',
    detail:
      'Check numbers make it easy to trace payments during disputes or audits. Never leave it blank if you have it.',
  },
  {
    icon: '📋',
    color: '#2E7D32',
    rule: 'Review auto-generated balance-due invoices',
    detail:
      'After recording a partial payment, open the new balance-due draft and confirm the amount before sending it to the customer.',
  },
];

const AR_GLOSSARY = [
  {
    term: 'AR Collected',
    definition:
      'Total cash collected through invoices marked Paid. Does not include payments recorded without a linked invoice.',
  },
  {
    term: 'AR Outstanding',
    definition:
      'Total dollar value of all open (unpaid) invoices right now across all active jobs.',
  },
  {
    term: 'Won Revenue YTD',
    definition:
      'Total contract value of all won/completed jobs this year — includes the full job value even if not fully invoiced yet. Will always be higher than AR Collected.',
  },
  {
    term: 'Amount Paid (on invoice)',
    definition:
      'How much of a specific invoice has been collected. Full payment = invoice amount. Partial = less than invoice amount.',
  },
  {
    term: 'Balance Due',
    definition: 'Invoice amount minus amount paid. Auto-generated as a new draft invoice when a partial payment is recorded.',
  },
];

export default function FieldGuide() {
  const [activeTab, setActiveTab] = useState('Checklist');
  const [checked, setChecked] = useState({});
  const [lang, setLang] = useState('both');
  const [stretchSearch, setStretchSearch] = useState('');

  const toggle = (key) => setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  const totalRequired = sections.flatMap((s) => s.items).filter((i) => i.required).length;
  const checkedCount = Object.values(checked).filter(Boolean).length;
  const progress = Math.round((checkedCount / totalRequired) * 100);

  const filteredTowns = STRETCH_TOWNS.filter((t) =>
    t.toLowerCase().includes(stretchSearch.toLowerCase()),
  );

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6fb', fontFamily: 'Arial, sans-serif' }}>
      {/* ── Header ── */}
      <div style={{ background: BLUE, color: 'white', padding: '18px 20px 0' }}>
        <div style={{ fontSize: 18, fontWeight: 'bold' }}>📋 Field Help Guide</div>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
          Preferred Builders General Services — HIC-197400
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 4, marginTop: 14, overflowX: 'auto' }}>
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '7px 14px',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: '6px 6px 0 0',
                whiteSpace: 'nowrap',
                background: activeTab === tab ? '#f4f6fb' : 'rgba(255,255,255,0.15)',
                color: activeTab === tab ? BLUE : 'white',
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ════════════════════════════════
          TAB: CHECKLIST
      ════════════════════════════════ */}
      {activeTab === 'Checklist' && (
        <>
          {/* Language toggle + progress */}
          <div
            style={{
              background: 'white',
              padding: '12px 20px',
              borderBottom: '1px solid #eee',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              {['both', 'en', 'pt'].map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 20,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 'bold',
                    background: lang === l ? BLUE : '#eee',
                    color: lang === l ? 'white' : '#555',
                  }}
                >
                  {l === 'both' ? '🇺🇸🇧🇷 Both' : l === 'en' ? '🇺🇸 EN' : '🇧🇷 PT'}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  marginBottom: 4,
                  color: '#666',
                }}
              >
                <span>
                  {checkedCount} / {totalRequired} required items
                </span>
                <span style={{ fontWeight: 'bold', color: progress === 100 ? GREEN : BLUE }}>
                  {progress}%
                </span>
              </div>
              <div style={{ background: '#e8eaf0', borderRadius: 8, height: 7 }}>
                <div
                  style={{
                    background: progress === 100 ? GREEN : BLUE,
                    height: 7,
                    borderRadius: 8,
                    width: `${progress}%`,
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            </div>
            {progress === 100 && (
              <span style={{ color: GREEN, fontWeight: 'bold', fontSize: 12 }}>✅ Ready!</span>
            )}
          </div>

          <div style={{ padding: 14 }}>
            {sections.map((section) => (
              <div
                key={section.title}
                style={{
                  background: 'white',
                  borderRadius: 10,
                  marginBottom: 10,
                  overflow: 'hidden',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
                }}
              >
                <div
                  style={{
                    background: BLUE,
                    color: 'white',
                    padding: '9px 16px',
                    fontWeight: 'bold',
                    fontSize: 12,
                  }}
                >
                  {section.icon} {section.title}
                </div>
                {section.items.map((item, i) => {
                  const key = `${section.title}-${i}`;
                  const isChecked = checked[key];
                  return (
                    <div
                      key={key}
                      onClick={() => toggle(key)}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12,
                        padding: '10px 16px',
                        cursor: 'pointer',
                        background: isChecked ? '#f0fff4' : item.warning ? '#fffbf0' : 'white',
                        borderLeft: item.warning ? `3px solid ${ORANGE}` : '3px solid transparent',
                        borderBottom: '1px solid #f3f3f3',
                      }}
                    >
                      <div
                        style={{
                          width: 19,
                          height: 19,
                          borderRadius: 4,
                          flexShrink: 0,
                          marginTop: 2,
                          border: `2px solid ${isChecked ? GREEN : '#bbb'}`,
                          background: isChecked ? GREEN : 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {isChecked && (
                          <span style={{ color: 'white', fontSize: 11, fontWeight: 'bold' }}>
                            ✓
                          </span>
                        )}
                      </div>
                      <div style={{ flex: 1 }}>
                        {(lang === 'both' || lang === 'en') && (
                          <div
                            style={{
                              fontSize: 12,
                              color: item.warning ? RED : '#222',
                              fontWeight: item.warning ? 'bold' : 'normal',
                            }}
                          >
                            {item.required && (
                              <span style={{ color: RED, fontSize: 9, marginRight: 3 }}>★</span>
                            )}
                            {item.en}
                          </div>
                        )}
                        {(lang === 'both' || lang === 'pt') && (
                          <div
                            style={{
                              fontSize: 11,
                              color: '#777',
                              marginTop: lang === 'both' ? 2 : 0,
                            }}
                          >
                            {item.pt}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            <div style={{ display: 'flex', gap: 10, marginBottom: 32 }}>
              <button
                onClick={() => setChecked({})}
                style={{
                  flex: 1,
                  padding: 12,
                  background: 'white',
                  border: `2px solid ${BLUE}`,
                  borderRadius: 8,
                  color: BLUE,
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                🔄 Reset / Reiniciar
              </button>
              <button
                onClick={() => {
                  const all = {};
                  sections.forEach((s) =>
                    s.items.forEach((_, i) => {
                      all[`${s.title}-${i}`] = true;
                    }),
                  );
                  setChecked(all);
                }}
                style={{
                  flex: 1,
                  padding: 12,
                  background: 'white',
                  border: `2px solid #ccc`,
                  borderRadius: 8,
                  color: '#555',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                ✅ Check All
              </button>
            </div>
          </div>
        </>
      )}

      {/* ════════════════════════════════
          TAB: PROCESS FLOW
      ════════════════════════════════ */}
      {activeTab === 'Process Flow' && (
        <div style={{ padding: 16 }}>
          <div
            style={{
              background: 'white',
              borderRadius: 10,
              padding: 16,
              marginBottom: 14,
              boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 'bold', color: BLUE, marginBottom: 4 }}>
              How Every Job Works
            </div>
            <div style={{ fontSize: 12, color: '#666', lineHeight: 1.5 }}>
              Every project follows this flow — from first call to final payment. Follow the steps
              in order. Never quote a price on site — always run it through the system.
            </div>
          </div>
          {PROCESS.map((step, idx) => (
            <div key={step.step} style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
              {/* connector line */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: BLUE,
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    fontSize: 13,
                  }}
                >
                  {step.step}
                </div>
                {idx < PROCESS.length - 1 && (
                  <div
                    style={{
                      width: 2,
                      flex: 1,
                      background: '#dde0e8',
                      marginTop: 4,
                      minHeight: 20,
                    }}
                  />
                )}
              </div>
              <div
                style={{
                  background: 'white',
                  borderRadius: 10,
                  padding: '12px 16px',
                  flex: 1,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
                  marginBottom: 4,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 'bold', color: BLUE }}>
                  {step.icon} {step.title}
                </div>
                <div style={{ fontSize: 12, color: '#555', marginTop: 5, lineHeight: 1.55 }}>
                  {step.body}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ════════════════════════════════
          TAB: STRETCH CODE TOWNS
      ════════════════════════════════ */}
      {activeTab === 'Stretch Code' && (
        <div style={{ padding: 16 }}>
          <div
            style={{
              background: '#fff8e1',
              border: `1px solid ${YELLOW}`,
              borderRadius: 10,
              padding: 14,
              marginBottom: 14,
            }}
          >
            <div style={{ fontWeight: 'bold', color: '#7B5800', fontSize: 13, marginBottom: 6 }}>
              ⚠️ What is the Stretch Energy Code?
            </div>
            <div style={{ fontSize: 12, color: '#5c4000', lineHeight: 1.6 }}>
              Towns that have adopted the MA Stretch Energy Code require{' '}
              <strong>stricter insulation and energy performance</strong> than the base building
              code. The most common impact for PB jobs:
              <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                <li>
                  <strong>Exterior walls must be 2×6</strong> (instead of 2×4) to fit the required
                  R-20 insulation
                </li>
                <li>Blower door test required at framing and final</li>
                <li>Air sealing is more intensive — affects labor time</li>
                <li>Heat pumps or high-efficiency HVAC often required</li>
              </ul>
              Always confirm before scoping. If in doubt, use 2×6 framing and document it.
            </div>
          </div>

          <input
            placeholder="Search town..."
            value={stretchSearch}
            onChange={(e) => setStretchSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid #ccc',
              fontSize: 13,
              marginBottom: 14,
              boxSizing: 'border-box',
            }}
          />

          <div
            style={{
              background: 'white',
              borderRadius: 10,
              boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: BLUE,
                color: 'white',
                padding: '9px 16px',
                fontWeight: 'bold',
                fontSize: 12,
              }}
            >
              🏛️ MA Stretch Code Towns ({filteredTowns.length} shown)
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                padding: 12,
                gap: 8,
              }}
            >
              {filteredTowns.map((town) => (
                <div
                  key={town}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: '#f0f4ff',
                    border: '1px solid #d0d8f0',
                    fontSize: 12,
                    color: BLUE,
                    fontWeight: 500,
                  }}
                >
                  ✓ {town}
                </div>
              ))}
              {filteredTowns.length === 0 && (
                <div style={{ gridColumn: '1/-1', color: '#888', fontSize: 13, padding: 8 }}>
                  No match — this town may not be on Stretch Code. Verify with the building dept.
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              background: 'white',
              borderRadius: 10,
              boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
              marginTop: 14,
              padding: 14,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 'bold', color: BLUE, marginBottom: 8 }}>
              🔍 Not sure? How to check:
            </div>
            <div style={{ fontSize: 12, color: '#555', lineHeight: 1.7 }}>
              1. Call the local building department and ask if they enforce the{' '}
              <em>Stretch Energy Code</em>
              <br />
              2. Check the MA DOER website: <strong>mass.gov/stretch-energy-code</strong>
              <br />
              3. When in doubt — scope 2×6, spray foam air barrier, heat pump HVAC. It's always
              correct.
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════
          TAB: EXCLUSIONS
      ════════════════════════════════ */}
      {activeTab === 'Exclusions' && (
        <div style={{ padding: 16 }}>
          <div
            style={{
              background: '#fef2f2',
              border: `1px solid #f5c6c6`,
              borderRadius: 10,
              padding: 14,
              marginBottom: 14,
            }}
          >
            <div style={{ fontWeight: 'bold', color: RED, fontSize: 13, marginBottom: 4 }}>
              🚫 What We Do NOT Include (by default)
            </div>
            <div style={{ fontSize: 12, color: '#7a2222', lineHeight: 1.5 }}>
              These items are <strong>excluded from every estimate</strong> unless the customer
              specifically requests them. Every contract should list these as explicit exclusions so
              there are no surprises at close-out.
            </div>
          </div>

          {EXCLUSIONS.map((row, i) => (
            <div
              key={i}
              style={{
                background: 'white',
                borderRadius: 8,
                marginBottom: 8,
                padding: '12px 16px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                borderLeft: `3px solid ${RED}`,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 'bold', color: '#222' }}>❌ {row.item}</div>
              <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{row.note}</div>
            </div>
          ))}

          <div
            style={{
              background: 'white',
              borderRadius: 10,
              padding: 14,
              marginTop: 6,
              boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 'bold', color: BLUE, marginBottom: 8 }}>
              📝 How to Handle "Can you include X?"
            </div>
            <div style={{ fontSize: 12, color: '#555', lineHeight: 1.7 }}>
              If a customer asks to add any of the above:
              <br />
              1. Note it explicitly in the job details in the system
              <br />
              2. Tell them you'll get pricing and add it as a <strong>separate line item</strong>
              <br />
              3. Never fold excluded items into the base estimate price — keep them visible and
              itemized
              <br />
              4. Make sure the contract addendum lists it separately
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════
          TAB: MARKUP CHAIN
      ════════════════════════════════ */}
      {activeTab === 'Markup Chain' && (
        <div style={{ padding: 16 }}>
          <div
            style={{
              background: 'white',
              borderRadius: 10,
              boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
              overflow: 'hidden',
              marginBottom: 14,
            }}
          >
            <div
              style={{
                background: BLUE,
                color: 'white',
                padding: '9px 16px',
                fontWeight: 'bold',
                fontSize: 12,
              }}
            >
              💰 PB Markup Chain — How Prices Are Built
            </div>
            {MARKUP_ROWS.map((row, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px 16px',
                  borderBottom: '1px solid #f3f3f3',
                  background: i === MARKUP_ROWS.length - 1 ? '#f0f4ff' : 'white',
                }}
              >
                <div
                  style={{
                    flex: 2,
                    fontSize: 13,
                    fontWeight: i === MARKUP_ROWS.length - 1 ? 'bold' : 'normal',
                    color: i === MARKUP_ROWS.length - 1 ? BLUE : '#333',
                  }}
                >
                  {row.label}
                </div>
                {row.example ? (
                  <div
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontWeight: 'bold',
                      color: GREEN,
                      textAlign: 'right',
                      paddingRight: 20,
                    }}
                  >
                    {row.example}
                  </div>
                ) : (
                  <div style={{ flex: 1 }} />
                )}
                <div style={{ flex: 2, fontSize: 11, color: '#777', textAlign: 'right' }}>
                  {row.note}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              background: '#f0fff4',
              border: `1px solid #a5d6a7`,
              borderRadius: 10,
              padding: 14,
              marginBottom: 14,
            }}
          >
            <div style={{ fontWeight: 'bold', color: GREEN, fontSize: 13, marginBottom: 6 }}>
              ✅ The AI handles all of this automatically
            </div>
            <div style={{ fontSize: 12, color: '#2a5c2a', lineHeight: 1.6 }}>
              When you describe the scope to the AI estimator, it applies the full 1.58× markup
              chain to every line. You do <strong>not</strong> manually add O&P or contingency — the
              system does it. Your job is to make sure the scope is accurate.
            </div>
          </div>

          <div
            style={{
              background: 'white',
              borderRadius: 10,
              boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
              padding: 14,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 'bold', color: BLUE, marginBottom: 8 }}>
              📌 When a Sub Gives You a Price
            </div>
            <div style={{ fontSize: 12, color: '#555', lineHeight: 1.7 }}>
              If a plumber quotes you $8,000 for rough-in:
              <br />
              • Enter $8,000 as the sub cost in the estimate
              <br />• The system adds GC O&P (25%) → <strong>$10,000</strong>
              <br />• Then adds contingency (10%) → <strong>$11,000</strong> billed to customer
              <br />
              <br />
              <strong>Never pass sub prices directly to the customer</strong> — always run through
              the system so markup is applied consistently.
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════
          TAB: PAYMENTS & INVOICING
      ════════════════════════════════ */}
      {activeTab === 'Payments & Invoicing' && (
        <div style={{ padding: 16 }}>

          {/* Invoice Types */}
          <div style={{ background: 'white', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: BLUE, color: 'white', padding: '9px 16px', fontWeight: 'bold', fontSize: 12 }}>
              🧾 Invoice Types — What Each One Means
            </div>
            {INVOICE_TYPES.map((inv, i) => (
              <div key={i} style={{ padding: '12px 16px', borderBottom: '1px solid #f3f3f3', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 10, minWidth: 10, height: 10, borderRadius: '50%', background: inv.color, marginTop: 4 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: inv.color, marginBottom: 2 }}>{inv.type}</div>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 2 }}><strong>When:</strong> {inv.when}</div>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 2 }}><strong>Amount:</strong> {inv.amount}</div>
                  <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>{inv.note}</div>
                </div>
              </div>
            ))}
          </div>

          {/* How to Record a Payment */}
          <div style={{ background: 'white', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: '#2E7D32', color: 'white', padding: '9px 16px', fontWeight: 'bold', fontSize: 12 }}>
              💵 How to Record a Payment — Step by Step
            </div>
            {PAYMENT_STEPS.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', padding: '12px 16px', borderBottom: '1px solid #f3f3f3', gap: 12 }}>
                <div style={{ width: 28, height: 28, minWidth: 28, borderRadius: '50%', background: '#2E7D32', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 13 }}>
                  {s.step}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: '#222', marginBottom: 2 }}>{s.icon} {s.title}</div>
                  <div style={{ fontSize: 12, color: '#555', lineHeight: 1.5 }}>{s.body}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Best Practices / Rules */}
          <div style={{ background: 'white', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: '#C62828', color: 'white', padding: '9px 16px', fontWeight: 'bold', fontSize: 12 }}>
              📌 Best Practices — Do This Every Time
            </div>
            {PAYMENT_RULES.map((r, i) => (
              <div key={i} style={{ padding: '12px 16px', borderBottom: '1px solid #f3f3f3', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 20, lineHeight: 1 }}>{r.icon}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: r.color, marginBottom: 3 }}>{r.rule}</div>
                  <div style={{ fontSize: 12, color: '#555', lineHeight: 1.5 }}>{r.detail}</div>
                </div>
              </div>
            ))}
          </div>

          {/* AR Glossary */}
          <div style={{ background: 'white', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: '#7B1FA2', color: 'white', padding: '9px 16px', fontWeight: 'bold', fontSize: 12 }}>
              📖 What the Numbers Mean — AR Glossary
            </div>
            {AR_GLOSSARY.map((g, i) => (
              <div key={i} style={{ padding: '12px 16px', borderBottom: '1px solid #f3f3f3' }}>
                <div style={{ fontSize: 13, fontWeight: 'bold', color: '#7B1FA2', marginBottom: 3 }}>{g.term}</div>
                <div style={{ fontSize: 12, color: '#555', lineHeight: 1.5 }}>{g.definition}</div>
              </div>
            ))}
          </div>

          {/* Quick reminder box */}
          <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 10, padding: 14 }}>
            <div style={{ fontWeight: 'bold', color: '#E07B2A', fontSize: 13, marginBottom: 6 }}>
              💡 AR Collected vs Won Revenue — Why They Never Match
            </div>
            <div style={{ fontSize: 12, color: '#5a3e00', lineHeight: 1.7 }}>
              <strong>Won Revenue</strong> counts the full contract value of every closed job — even if you've only collected part of it so far.
              <br />
              <strong>AR Collected</strong> counts only cash that's actually come in through paid invoices.
              <br /><br />
              Example: You win a $300K job and collect the $100K deposit. Won Revenue = $300K. AR Collected = $100K. Both numbers are correct — they're just measuring different things.
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
