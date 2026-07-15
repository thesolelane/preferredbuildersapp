import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { showToast } from '../utils/toast';
import DEPARTMENTS_FALLBACK from '../data/departments.json';

const inputStyle = {
  width: '100%',
  padding: '9px 11px',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: 13,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  outline: 'none',
};

const labelStyle = {
  fontSize: 11,
  color: '#555',
  display: 'block',
  marginBottom: 4,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

// ── Trade Selection step ───────────────────────────────────────────────────
function TradeSelectionStep({
  selectedTrades,
  onToggleTrade,
  onBack,
  onNext,
  fetchingQuestions,
  extractingFiles,
  departments,
}) {
  const DEPARTMENTS = departments || DEPARTMENTS_FALLBACK;
  const [openDepts, setOpenDepts] = useState({});

  const toggleDept = (deptId) => {
    setOpenDepts((prev) => ({ ...prev, [deptId]: !prev[deptId] }));
  };

  const isDeptPartiallySelected = (dept) =>
    dept.subDepartments.some((s) => selectedTrades.has(s.id));

  const isDeptFullySelected = (dept) => dept.subDepartments.every((s) => selectedTrades.has(s.id));

  const toggleDeptAll = (dept) => {
    const allSelected = isDeptFullySelected(dept);
    const next = new Set(selectedTrades);
    for (const sub of dept.subDepartments) {
      if (allSelected) next.delete(sub.id);
      else next.add(sub.id);
    }
    onToggleTrade(next);
  };

  const toggleSub = (subId) => {
    const next = new Set(selectedTrades);
    if (next.has(subId)) next.delete(subId);
    else next.add(subId);
    onToggleTrade(next);
  };

  const totalSelected = selectedTrades.size;

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1B3A6B' }}>
          Trades Involved
        </h3>
        <p style={{ fontSize: 12, color: '#777', margin: '6px 0 0' }}>
          Select the trades that apply to this project. The AI uses these to generate more accurate
          questions and line items.{' '}
          <span style={{ color: '#aaa' }}>This step is optional — skip if unsure.</span>
        </p>
      </div>

      {totalSelected > 0 && (
        <div
          style={{
            marginBottom: 12,
            padding: '6px 10px',
            background: '#eef3ff',
            borderRadius: 6,
            fontSize: 12,
            color: '#1B3A6B',
            fontWeight: 600,
          }}
        >
          {totalSelected} sub-department{totalSelected !== 1 ? 's' : ''} selected
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          maxHeight: '52vh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          paddingRight: 4,
          paddingBottom: 4,
        }}
      >
        {DEPARTMENTS.map((dept) => {
          const isOpen = !!openDepts[dept.id];
          const partial = isDeptPartiallySelected(dept);
          const full = isDeptFullySelected(dept);

          return (
            <div
              key={dept.id}
              style={{
                border: `1px solid ${partial ? '#1B3A6B' : '#b8c5d6'}`,
                borderRadius: 8,
                overflow: 'hidden',
                background: partial ? '#f5f8ff' : '#fff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
                flexShrink: 0,
              }}
            >
              {/* Department header row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '13px 14px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  background: partial ? '#ddeaff' : '#e8edf5',
                }}
                onClick={() => toggleDept(dept.id)}
              >
                <input
                  type="checkbox"
                  checked={full}
                  ref={(el) => {
                    if (el) el.indeterminate = partial && !full;
                  }}
                  onChange={(e) => {
                    e.stopPropagation();
                    toggleDeptAll(dept);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: 17,
                    height: 17,
                    cursor: 'pointer',
                    flexShrink: 0,
                    accentColor: '#1B3A6B',
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    fontWeight: 700,
                    fontSize: 15,
                    color: '#111',
                    marginLeft: 12,
                    letterSpacing: 0.1,
                  }}
                >
                  {dept.name}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: partial ? '#1B3A6B' : '#bbb',
                    marginRight: 8,
                    fontWeight: 600,
                  }}
                >
                  {partial
                    ? `${dept.subDepartments.filter((s) => selectedTrades.has(s.id)).length}/${dept.subDepartments.length}`
                    : ''}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: '#94a3b8',
                    transform: isOpen ? 'rotate(90deg)' : 'none',
                    transition: 'transform 0.15s',
                    display: 'inline-block',
                  }}
                >
                  ▶
                </span>
              </div>

              {/* Sub-departments */}
              {isOpen && (
                <div style={{ borderTop: '1px solid #dde5f0', background: '#fff' }}>
                  {dept.subDepartments.map((sub) => (
                    <label
                      key={sub.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '11px 14px 11px 34px',
                        cursor: 'pointer',
                        borderBottom: '1px solid #eef2f8',
                        background: selectedTrades.has(sub.id) ? '#f0f5ff' : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTrades.has(sub.id)}
                        onChange={() => toggleSub(sub.id)}
                        style={{
                          width: 16,
                          height: 16,
                          cursor: 'pointer',
                          accentColor: '#1B3A6B',
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 14,
                          color: '#1e293b',
                          fontWeight: selectedTrades.has(sub.id) ? 600 : 400,
                        }}
                      >
                        {sub.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 18 }}>
        <button
          onClick={onBack}
          disabled={fetchingQuestions || extractingFiles}
          style={{
            padding: '10px 20px',
            border: '1px solid #ddd',
            borderRadius: 6,
            background: 'white',
            cursor: fetchingQuestions || extractingFiles ? 'not-allowed' : 'pointer',
            fontSize: 13,
            color: '#555',
          }}
        >
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={fetchingQuestions || extractingFiles}
          style={{
            padding: '10px 24px',
            borderRadius: 6,
            border: 'none',
            fontSize: 13,
            fontWeight: 700,
            background: fetchingQuestions || extractingFiles ? '#c5ccd8' : '#1B3A6B',
            color: 'white',
            cursor: fetchingQuestions || extractingFiles ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {extractingFiles ? (
            <>
              <span
                style={{
                  display: 'inline-block',
                  animation: 'spin 1s linear infinite',
                  fontSize: 14,
                }}
              >
                ⟳
              </span>
              Reading files...
            </>
          ) : fetchingQuestions ? (
            <>
              <span
                style={{
                  display: 'inline-block',
                  animation: 'spin 1s linear infinite',
                  fontSize: 14,
                }}
              >
                ⟳
              </span>
              AI is thinking...
            </>
          ) : totalSelected === 0 ? (
            'Skip →'
          ) : (
            'Next →'
          )}
        </button>
      </div>
    </div>
  );
}

// ── AI Questions step ──────────────────────────────────────────────────────
function AIQuestionsStep({ questions, answers, onAnswer, onBack, onNext }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [localAnswer, setLocalAnswer] = useState('');
  const [localDemoCost, setLocalDemoCost] = useState('');
  const [waitingForDemoCost, setWaitingForDemoCost] = useState(false);

  const currentQ = questions[currentIdx];
  const totalQ = questions.length;
  const isLast = currentIdx === totalQ - 1;
  const existingAnswer = answers.find((a) => a.questionId === currentQ?.id);

  useEffect(() => {
    setLocalAnswer(existingAnswer?.answer || '');
    setLocalDemoCost(existingAnswer?.demoCost || '');
    setWaitingForDemoCost(
      existingAnswer?.answer === 'no' && currentQ?.questionType === 'demo_check',
    );
  }, [currentIdx]);

  if (!currentQ) return null;

  const handleChip = (val) => {
    setLocalAnswer(val);
    if (currentQ.questionType === 'demo_check' && val === 'no') {
      setWaitingForDemoCost(true);
    } else {
      setWaitingForDemoCost(false);
      setLocalDemoCost('');
    }
  };

  const canAdvance = () => {
    if (currentQ.answerType === 'text' && !localAnswer.trim()) return false;
    if (currentQ.answerType === 'yesno' && !localAnswer) return false;
    if (currentQ.questionType === 'demo_check' && localAnswer === 'no' && !localDemoCost.trim())
      return false;
    return true;
  };

  const skipQuestion = () => {
    const record = {
      questionId: currentQ.id,
      question: currentQ.question,
      questionType: currentQ.questionType,
      trade: currentQ.trade,
      answer: 'skipped',
      demoCost: null,
    };
    const updated = [...answers.filter((a) => a.questionId !== currentQ.id), record];
    onAnswer(updated);
    if (isLast) {
      onNext(updated);
    } else {
      setCurrentIdx((i) => i + 1);
      setLocalAnswer('');
      setLocalDemoCost('');
      setWaitingForDemoCost(false);
    }
  };

  const saveAndAdvance = () => {
    const record = {
      questionId: currentQ.id,
      question: currentQ.question,
      questionType: currentQ.questionType,
      trade: currentQ.trade,
      answer: localAnswer,
      demoCost:
        localAnswer === 'no' && currentQ.questionType === 'demo_check'
          ? localDemoCost.replace(/[$,\s]/g, '')
          : null,
    };
    const updated = [...answers.filter((a) => a.questionId !== currentQ.id), record];
    onAnswer(updated);
    if (isLast) {
      onNext(updated);
    } else {
      setCurrentIdx((i) => i + 1);
      setLocalAnswer('');
      setLocalDemoCost('');
      setWaitingForDemoCost(false);
    }
  };

  const goBack = () => {
    if (currentIdx === 0) {
      onBack();
    } else {
      const prev = questions[currentIdx - 1];
      const prevAns = answers.find((a) => a.questionId === prev?.id);
      setCurrentIdx((i) => i - 1);
      setLocalAnswer(prevAns?.answer || '');
      setLocalDemoCost(prevAns?.demoCost || '');
      setWaitingForDemoCost(prevAns?.answer === 'no' && prev?.questionType === 'demo_check');
    }
  };

  return (
    <div style={{ padding: '24px 28px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1B3A6B' }}>
          AI Clarifying Questions
        </h3>
        <span style={{ fontSize: 12, color: '#888' }}>
          {currentIdx + 1} of {totalQ}
        </span>
      </div>
      <p style={{ fontSize: 12, color: '#777', margin: '0 0 16px' }}>
        Answer each question to make sure the estimate is complete.
      </p>

      {/* Progress dots */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        {questions.map((_, i) => (
          <div
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: i < currentIdx ? '#059669' : i === currentIdx ? '#1B3A6B' : '#e5e7eb',
            }}
          />
        ))}
      </div>

      {/* Question Card */}
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: 18,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 20 }}>
            {currentQ.questionType === 'demo_check'
              ? '🏗️'
              : currentQ.questionType === 'trade_clarification'
                ? '🔧'
                : '📋'}
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#1e293b', lineHeight: 1.5 }}>
              {currentQ.question}
            </div>
            {currentQ.hint && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{currentQ.hint}</div>
            )}
          </div>
        </div>

        {currentQ.answerType === 'yesno' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { val: 'yes', label: 'Yes — already included', color: '#059669' },
              { val: 'no', label: 'No — needs to be added', color: '#C62828' },
              { val: 'not_sure', label: 'Not sure', color: '#888' },
            ].map((opt) => (
              <button
                key={opt.val}
                onClick={() => handleChip(opt.val)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 20,
                  fontSize: 12,
                  cursor: 'pointer',
                  border: `2px solid ${localAnswer === opt.val ? opt.color : '#e2e8f0'}`,
                  background: localAnswer === opt.val ? opt.color + '18' : 'white',
                  color: localAnswer === opt.val ? opt.color : '#64748b',
                  fontWeight: localAnswer === opt.val ? 700 : 400,
                  transition: 'all 0.15s',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {currentQ.answerType === 'text' && (
          <textarea
            rows={3}
            value={localAnswer}
            onChange={(e) => setLocalAnswer(e.target.value)}
            placeholder="Type your answer..."
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        )}

        {waitingForDemoCost && currentQ.questionType === 'demo_check' && (
          <div
            style={{
              marginTop: 14,
              padding: 14,
              background: '#fff7ed',
              border: '1px solid #fed7aa',
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: '#9a3412', marginBottom: 8 }}>
              What should we estimate for removing the existing {currentQ.trade}?
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#555', fontSize: 14, fontWeight: 'bold' }}>$</span>
              <input
                type="number"
                value={localDemoCost}
                onChange={(e) => setLocalDemoCost(e.target.value)}
                placeholder="e.g. 1500"
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  border: '1px solid #fed7aa',
                  borderRadius: 6,
                  fontSize: 13,
                }}
              />
            </div>
            <div style={{ fontSize: 11, color: '#c2410c', marginTop: 6 }}>
              This will be added as a Demo line item in the estimate.
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <button
          onClick={goBack}
          style={{
            padding: '10px 20px',
            border: '1px solid #ddd',
            borderRadius: 6,
            background: 'white',
            cursor: 'pointer',
            fontSize: 13,
            color: '#555',
          }}
        >
          ← Back
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          {currentQ.answerType === 'text' && (
            <button
              onClick={skipQuestion}
              style={{
                padding: '10px 16px',
                borderRadius: 6,
                border: '1px solid #ddd',
                background: 'white',
                fontSize: 12,
                color: '#888',
                cursor: 'pointer',
              }}
            >
              Skip
            </button>
          )}
          <button
            onClick={saveAndAdvance}
            disabled={!canAdvance()}
            style={{
              padding: '10px 24px',
              borderRadius: 6,
              border: 'none',
              fontSize: 13,
              fontWeight: 700,
              background: canAdvance() ? '#1B3A6B' : '#c5ccd8',
              color: 'white',
              cursor: canAdvance() ? 'pointer' : 'not-allowed',
            }}
          >
            {isLast ? 'Review Estimate →' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Review step (Phase 2 — includes Q&A summary and demo additions) ─────────
function ReviewStep({
  contact,
  address,
  scope,
  budgetTarget,
  selectedTrades,
  answers,
  onBack,
  onSubmit,
  busy,
  departments = DEPARTMENTS_FALLBACK,
}) {
  const demoAdditions = answers.filter(
    (a) => a.questionType === 'demo_check' && a.answer === 'no' && a.demoCost,
  );
  const projectAddress = [address.street, address.city, address.state, address.zip]
    .filter(Boolean)
    .join(', ');

  const selectedSubNames = buildSelectedTradesList(selectedTrades, departments);

  const sections = [
    {
      label: 'Contact',
      rows: [
        { key: 'Name', value: contact.name },
        { key: 'Phone', value: contact.phone || '—' },
        { key: 'Email', value: contact.email || '—' },
      ],
    },
    {
      label: 'Job Address',
      rows: [{ key: '', value: projectAddress || '—' }],
    },
    {
      label: 'Scope of Work',
      rows: [
        { key: '', value: scope },
        ...(budgetTarget
          ? [
              {
                key: 'Budget Target',
                value:
                  '$' +
                  Number(String(budgetTarget).replace(/,/g, '')).toLocaleString() +
                  ' (±8% soft target)',
              },
            ]
          : []),
      ],
    },
  ];

  return (
    <div style={{ padding: '24px 28px' }}>
      <p style={{ fontSize: 13, color: '#555', marginTop: 0, marginBottom: 16 }}>
        Review everything before generating the proposal.
      </p>

      {sections.map((section) => (
        <div
          key={section.label}
          style={{
            background: '#f8f9fc',
            borderRadius: 8,
            padding: '14px 16px',
            marginBottom: 12,
            border: '1px solid #e8eaf0',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#1B3A6B',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 8,
            }}
          >
            {section.label}
          </div>
          {section.rows.map((row, i) => (
            <div
              key={i}
              style={{
                fontSize: 13,
                color: '#333',
                marginBottom: row.key ? 4 : 0,
                whiteSpace: row.key ? 'normal' : 'pre-wrap',
              }}
            >
              {row.key ? (
                <>
                  <span style={{ color: '#888', marginRight: 6 }}>{row.key}:</span>
                  {row.value}
                </>
              ) : (
                row.value
              )}
            </div>
          ))}
        </div>
      ))}

      {selectedSubNames.length > 0 && (
        <div
          style={{
            background: '#f8f9fc',
            borderRadius: 8,
            padding: '14px 16px',
            marginBottom: 12,
            border: '1px solid #e8eaf0',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#1B3A6B',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 8,
            }}
          >
            Trades Selected
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {selectedSubNames.map((name, i) => (
              <span
                key={i}
                style={{
                  background: '#e8f0fe',
                  color: '#1B3A6B',
                  borderRadius: 20,
                  padding: '3px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {demoAdditions.length > 0 && (
        <div
          style={{
            background: '#fff7ed',
            border: '1px solid #fed7aa',
            borderRadius: 8,
            padding: '14px 16px',
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#c2410c',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 8,
            }}
          >
            Demo Work Added from Q&A
          </div>
          {demoAdditions.map((a, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 13,
                color: '#9a3412',
                marginBottom: 4,
              }}
            >
              <span>Demo — Remove {a.trade}</span>
              <span style={{ fontWeight: 700 }}>${Number(a.demoCost).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      {answers.length > 0 && (
        <div
          style={{
            background: '#f8f9fc',
            borderRadius: 8,
            padding: '14px 16px',
            marginBottom: 12,
            border: '1px solid #e8eaf0',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#1B3A6B',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 10,
            }}
          >
            AI Q&A Answers
          </div>
          {answers.map((a, i) => (
            <div
              key={i}
              style={{
                marginBottom: 10,
                paddingBottom: 10,
                borderBottom: i < answers.length - 1 ? '1px solid #e2e8f0' : 'none',
              }}
            >
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 3 }}>{a.question}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#1e293b' }}>
                {a.answer === 'yes'
                  ? '✓ Yes — already included'
                  : a.answer === 'no'
                    ? `✗ No — demo added ($${Number(a.demoCost || 0).toLocaleString()})`
                    : a.answer === 'not_sure'
                      ? '~ Not sure'
                      : a.answer}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 4 }}>
        <button
          onClick={onBack}
          style={{
            padding: '10px 20px',
            border: '1px solid #ddd',
            borderRadius: 6,
            background: 'white',
            cursor: 'pointer',
            fontSize: 13,
            color: '#555',
          }}
        >
          ← Back
        </button>
        <button
          onClick={onSubmit}
          disabled={busy}
          style={{
            padding: '10px 24px',
            borderRadius: 6,
            border: 'none',
            fontWeight: 700,
            fontSize: 14,
            background: busy ? '#888' : '#1B3A6B',
            color: 'white',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? '⏳ Generating...' : '🤖 Generate Proposal'}
        </button>
      </div>
    </div>
  );
}

// Build a flat list of selected sub-department names (for display and AI context)
function buildSelectedTradesList(selectedTrades, departments = DEPARTMENTS_FALLBACK) {
  if (!selectedTrades || selectedTrades.size === 0) return [];
  const names = [];
  for (const dept of departments) {
    for (const sub of dept.subDepartments) {
      if (selectedTrades.has(sub.id)) names.push(sub.name);
    }
  }
  return names;
}

// Build the AI context block from selected trades
function buildTradesContext(selectedTrades, departments = DEPARTMENTS_FALLBACK) {
  if (!selectedTrades || selectedTrades.size === 0) return '';
  const lines = [];
  for (const dept of departments) {
    const selected = dept.subDepartments.filter((s) => selectedTrades.has(s.id));
    if (selected.length === 0) continue;
    for (const sub of selected) {
      lines.push(`- ${sub.name} (${dept.name}): ${sub.meaning}`);
    }
  }
  if (lines.length === 0) return '';
  return `\n\nEXPLICITLY SELECTED TRADES (user-confirmed before AI questions):\n${lines.join('\n')}\nUse this list to calibrate line items and clarifying questions — these trades are confirmed to be in scope.`;
}

const LS_DRAFT_KEY = 'pb_wizard_draft';

// ── Main wizard component ──────────────────────────────────────────────────
export default function CreateQuoteWizard({ token, onClose, onSubmitted, prefillLead, prefillDraft }) {
  // STEPS: 0=Contact, 1=Job Address, 2=Scope, 3=Trades, 4=AI Questions (dynamic), 5=Review
  const TRADE_STEP = 3;
  const BASE_STEPS = ['Contact', 'Job Address', 'Scope of Work', 'Trades', 'Review'];

  const navigate = useNavigate();
  const [step, setStep] = useState(prefillDraft?.step || 0);
  const [busy, setBusy] = useState(false);
  const [fetchingQuestions, setFetchingQuestions] = useState(false);

  const [contact, setContact] = useState({
    name: prefillLead?.caller_name || prefillDraft?.contact?.name || '',
    phone: prefillLead?.caller_phone || prefillDraft?.contact?.phone || '',
    email: prefillLead?.job_email || prefillDraft?.contact?.email || '',
  });
  const [address, setAddress] = useState({
    street: prefillLead?.job_address || prefillDraft?.address?.street || '',
    city: prefillLead?.job_city || prefillDraft?.address?.city || '',
    state: prefillDraft?.address?.state || '',
    zip: prefillDraft?.address?.zip || '',
  });
  const [scope, setScope] = useState(() => {
    const jobScope = prefillLead?.job_scope || '';
    const notes = prefillLead?.notes || '';
    if (jobScope && notes && !jobScope.includes(notes)) {
      return `${jobScope}\n\n--- Site Visit Notes ---\n${notes}`;
    }
    if (!jobScope && notes) return notes;
    if (jobScope) return jobScope;
    return prefillDraft?.scope || '';
  });
  const [jobType, setJobType] = useState(prefillLead?.job_type || prefillDraft?.jobType || '');
  const [budgetTarget, setBudgetTarget] = useState(prefillDraft?.budgetTarget || '');

  const [selectedTrades, setSelectedTrades] = useState(
    new Set(prefillDraft?.selectedTrades || []),
  );

  const [wizardQuestions, setWizardQuestions] = useState(prefillDraft?.wizardQuestions || []);
  const [wizardAnswers, setWizardAnswers] = useState(prefillDraft?.wizardAnswers || []);
  const [aiStepInserted, setAiStepInserted] = useState(prefillDraft?.aiStepInserted || false);

  const [attachedFiles, setAttachedFiles] = useState([]);
  const [extractingFiles, setExtractingFiles] = useState(false);
  const [plansTempId, setPlansTempId] = useState(null);
  const fileInputRef = useRef(null);

  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestTimeout = useRef(null);
  const nameRef = useRef(null);

  const headers = { 'x-auth-token': token };

  // Load department definitions from DB (falls back to static JSON if unavailable)
  const [departments, setDepartments] = useState(DEPARTMENTS_FALLBACK);
  useEffect(() => {
    fetch('/api/departments', { headers: { 'x-auth-token': token } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setDepartments(data);
      })
      .catch(() => {});
  }, [token]);

  // ── Draft save / restore ─────────────────────────────────────────────────
  const [pendingDraft, setPendingDraft] = useState(null);
  const [draftSaving, setDraftSaving] = useState(false);

  useEffect(() => {
    if (!prefillLead?.id) return;
    fetch(`/api/leads/${prefillLead.id}/wizard-draft`, { headers })
      .then((r) => r.json())
      .then(({ draft }) => {
        if (draft && draft.savedAt) setPendingDraft(draft);
      })
      .catch(() => {});
  }, [prefillLead?.id]);

  const saveDraft = async () => {
    if (!prefillLead?.id) return;
    setDraftSaving(true);
    const draft = {
      savedAt: new Date().toISOString(),
      step,
      contact,
      address,
      scope,
      jobType,
      budgetTarget,
      selectedTrades: [...selectedTrades],
      wizardQuestions,
      wizardAnswers,
      aiStepInserted,
    };
    await fetch(`/api/leads/${prefillLead.id}/wizard-draft`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft }),
    }).catch(() => {});
    setDraftSaving(false);
    showToast('Draft saved — resume from any device', 'success');
  };

  const restoreDraft = (draft) => {
    if (draft.contact) setContact(draft.contact);
    if (draft.address) setAddress(draft.address);
    if (draft.scope !== undefined) setScope(draft.scope);
    if (draft.jobType) setJobType(draft.jobType);
    if (draft.budgetTarget) setBudgetTarget(draft.budgetTarget);
    if (draft.selectedTrades) setSelectedTrades(new Set(draft.selectedTrades));
    if (draft.wizardQuestions) setWizardQuestions(draft.wizardQuestions);
    if (draft.wizardAnswers) setWizardAnswers(draft.wizardAnswers);
    if (draft.aiStepInserted) setAiStepInserted(draft.aiStepInserted);
    if (typeof draft.step === 'number') setStep(draft.step);
    setPendingDraft(null);
    showToast('Draft restored — pick up where you left off');
  };

  const clearDraft = () => {
    if (!prefillLead?.id) return;
    fetch(`/api/leads/${prefillLead.id}/wizard-draft`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: null }),
    }).catch(() => {});
  };

  // ── Autosave: silently save 15s after any key field changes ─────────────
  const [lastAutoSave, setLastAutoSave] = useState(null);
  const autoSaveTimer = useRef(null);

  useEffect(() => {
    if (!prefillLead?.id || pendingDraft) return;
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      const draft = {
        savedAt: new Date().toISOString(),
        step,
        contact,
        address,
        scope,
        jobType,
        budgetTarget,
        selectedTrades: [...selectedTrades],
        wizardQuestions,
        wizardAnswers,
        aiStepInserted,
      };
      await fetch(`/api/leads/${prefillLead.id}/wizard-draft`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft }),
      }).catch(() => {});
      setLastAutoSave(new Date());
    }, 15000);
    return () => clearTimeout(autoSaveTimer.current);
  }, [scope, contact, address, jobType, budgetTarget, selectedTrades, wizardAnswers, step]);

  // ── localStorage auto-save for fresh (non-lead) wizards ──────────────────
  // Keeps a ref to the latest draft so the unmount cleanup can save it
  // even when a forced logout destroys the component before effects fire.
  const latestDraftRef = useRef(null);

  useEffect(() => {
    if (prefillLead) return;
    const hasData = !!(contact.name?.trim() || scope?.trim() || address.street?.trim());
    if (!hasData) return;
    const draft = {
      savedAt: new Date().toISOString(),
      step,
      contact,
      address,
      scope,
      jobType,
      budgetTarget,
      selectedTrades: [...selectedTrades],
      wizardQuestions,
      wizardAnswers,
      aiStepInserted,
    };
    latestDraftRef.current = draft;
    try {
      localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(draft));
    } catch {}
  }, [scope, contact, address, jobType, budgetTarget, selectedTrades, wizardAnswers, step]);

  // Save on unmount — catches forced logouts and tab closes
  useEffect(() => {
    if (prefillLead) return;
    return () => {
      const draft = latestDraftRef.current;
      if (!draft) return;
      try {
        localStorage.setItem(LS_DRAFT_KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
      } catch {}
    };
  }, []);

  // Show restore toast once when wizard is opened from a saved draft
  const didShowRestoreToast = useRef(false);
  useEffect(() => {
    if (prefillDraft && !didShowRestoreToast.current) {
      didShowRestoreToast.current = true;
      showToast('Draft restored — pick up where you left off');
    }
  }, []);

  // ── Close handler — saves draft + creates reminder task ──────────────────
  const handleClose = async () => {
    if (!prefillLead) {
      const hasData = !!(contact.name?.trim() || scope?.trim() || address.street?.trim());
      if (hasData) {
        const draft = {
          savedAt: new Date().toISOString(),
          step,
          contact,
          address,
          scope,
          jobType,
          budgetTarget,
          selectedTrades: [...selectedTrades],
          wizardQuestions,
          wizardAnswers,
          aiStepInserted,
        };
        try {
          localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(draft));
        } catch {}
        const label = contact.name?.trim() || 'New Job';
        const descParts = [];
        if (address.street) {
          descParts.push(
            `Address: ${[address.street, address.city].filter(Boolean).join(', ')}`,
          );
        }
        if (scope?.trim()) {
          const preview = scope.trim().slice(0, 200);
          descParts.push(`Scope: ${preview}${scope.length > 200 ? '...' : ''}`);
        }
        descParts.push('Reopen from Dashboard → Resume Draft button.');
        try {
          await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'x-auth-token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: `Resume estimate — ${label}`,
              description: descParts.join('\n'),
              priority: 'normal',
            }),
          });
        } catch {}
        showToast('Draft saved — resume from the Dashboard', 'success');
      }
    }
    onClose();
  };

  // Step layout: Trades step is always step 3.
  // AI Questions step is inserted at step 4 if questions are returned.
  const STEPS = aiStepInserted
    ? ['Contact', 'Job Address', 'Scope of Work', 'Trades', 'AI Questions', 'Review']
    : BASE_STEPS;

  const REVIEW_STEP = STEPS.length - 1;
  const AI_STEP = aiStepInserted ? 4 : -1;

  const fetchSuggestions = (query) => {
    clearTimeout(suggestTimeout.current);
    if (!query || query.length < 2) {
      setSuggestions([]);
      return;
    }
    suggestTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?search=${encodeURIComponent(query)}&limit=6`, {
          headers,
        });
        const data = await res.json();
        setSuggestions(data.contacts || []);
      } catch {
        setSuggestions([]);
      }
    }, 250);
  };

  const applySuggestion = (c) => {
    setContact({ name: c.name || '', phone: c.phone || '', email: c.email || '' });
    if (c.address || c.city || c.state) {
      setAddress((prev) => ({
        street: c.address || prev.street,
        city: c.city || prev.city,
        state: c.state || prev.state,
        zip: prev.zip,
      }));
    }
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleNameChange = (val) => {
    setContact((prev) => ({ ...prev, name: val }));
    setShowSuggestions(true);
    fetchSuggestions(val);
  };

  useEffect(() => {
    const handler = (e) => {
      if (nameRef.current && !nameRef.current.contains(e.target)) setShowSuggestions(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    return () => clearTimeout(suggestTimeout.current);
  }, []);

  const canNext = () => {
    if (step === 0) return contact.name.trim().length > 0;
    if (step === 1) return true;
    if (step === 2) return scope.trim().length >= 20 || attachedFiles.length > 0;
    return true;
  };

  const handleNextFromScope = () => {
    // Move to trade selection step — file extraction and AI questions come after trades
    setStep(TRADE_STEP);
  };

  const handleNextFromTrades = async () => {
    setFetchingQuestions(true);

    // If files are attached, extract text from them first and append to scope
    let finalScope = scope;
    if (attachedFiles.length > 0) {
      setExtractingFiles(true);
      try {
        const fd = new FormData();
        attachedFiles.forEach((f, i) => fd.append(`file_${i}`, f));
        const extractRes = await fetch('/api/jobs/extract-from-files', {
          method: 'POST',
          headers,
          body: fd,
        });
        if (extractRes.ok) {
          const { extractedText, extractedAddress, tempId } = await extractRes.json();
          if (tempId) setPlansTempId(tempId);
          if (extractedText) {
            finalScope = scope.trim()
              ? `${scope.trim()}\n\n--- EXTRACTED FROM UPLOADED FILES ---\n${extractedText}`
              : extractedText;
            setScope(finalScope);
          }
          if (extractedAddress?.street) {
            const addrEmpty = !address.street.trim() && !address.city.trim();
            const addrIncomplete = !address.street.trim() || !address.city.trim();
            if (addrEmpty || addrIncomplete) {
              setAddress((prev) => ({
                street: extractedAddress.street || prev.street,
                city: extractedAddress.city || prev.city,
                state: extractedAddress.state || prev.state,
                zip: extractedAddress.zip || prev.zip,
              }));
              showToast(
                `Address found in plans: ${extractedAddress.street}, ${extractedAddress.city}`,
                'success',
              );
            }
          } else if (!address.street.trim() || !address.city.trim()) {
            showToast(
              'No address found in plans — please fill in the job address on step 2.',
              'warning',
            );
          }
        } else {
          const err = await extractRes.json();
          showToast('Could not read attached files: ' + (err.error || 'Unknown error'), 'warning');
        }
      } catch {
        showToast('File extraction failed — proceeding with typed scope only.', 'warning');
      }
      setExtractingFiles(false);
    }

    const tradesContext = buildTradesContext(selectedTrades, departments);
    const scopeWithTrades = finalScope + tradesContext;

    try {
      const projectAddress = [address.street, address.city, address.state, address.zip]
        .filter(Boolean)
        .join(', ');
      const res = await fetch('/api/jobs/wizard/questions', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scopeText: scopeWithTrades,
          projectAddress,
          budgetTarget: budgetTarget ? Number(budgetTarget.replace(/,/g, '')) : null,
          selectedTrades: buildSelectedTradesPayload(selectedTrades, departments),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const questions = data.questions || [];
        if (questions.length > 0) {
          setWizardQuestions(questions);
          setWizardAnswers([]);
          setAiStepInserted(true);
          setStep(4);
        } else {
          setAiStepInserted(false);
          setStep(REVIEW_STEP);
        }
      } else {
        showToast('Could not load AI questions — you can still generate the proposal.', 'warning');
        setAiStepInserted(false);
        setStep(REVIEW_STEP);
      }
    } catch {
      showToast('Network error. Proceeding to review.', 'warning');
      setAiStepInserted(false);
      setStep(REVIEW_STEP);
    }
    setFetchingQuestions(false);
  };

  const handleQuestionsComplete = (finalAnswers) => {
    setWizardAnswers(finalAnswers);
    setStep(REVIEW_STEP);
  };

  const submit = async () => {
    if (!address.street.trim() || !address.city.trim()) {
      showToast(
        'Job address is required — please go back and fill in the street and city.',
        'error',
      );
      setStep(1);
      return;
    }
    setBusy(true);
    try {
      const projectAddress = [address.street, address.city, address.state, address.zip]
        .filter(Boolean)
        .join(', ');
      const res = await fetch('/api/jobs/wizard/submit', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: contact.name,
          customerPhone: contact.phone,
          customerEmail: contact.email,
          projectAddress,
          scopeText: scope,
          jobType: jobType || null,
          qaAnswers: wizardAnswers,
          budgetTarget: budgetTarget ? Number(budgetTarget.replace(/,/g, '')) : null,
          plansTempId: plansTempId || null,
          selectedTrades: buildSelectedTradesPayload(selectedTrades, departments),
        }),
      });
      const data = await res.json();
      setBusy(false);
      if (res.ok) {
        if (data.duplicateWarning?.length) {
          const names = data.duplicateWarning.map((d) => d.pb_number || d.id).join(', ');
          showToast(`⚠️ Possible duplicate — similar job already exists: ${names}`, 'warning');
        } else {
          showToast('Proposal submitted — processing now');
        }
        clearDraft();
        try { localStorage.removeItem(LS_DRAFT_KEY); } catch {}
        onSubmitted(data.jobId);
        onClose();
        navigate(`/jobs/${data.jobId}`);
      } else {
        showToast(data.error || 'Error submitting proposal', 'error');
      }
    } catch {
      setBusy(false);
      showToast('Network error — please try again', 'error');
    }
  };

  const handleBack = () => {
    if (step === REVIEW_STEP && aiStepInserted) {
      setStep(AI_STEP);
    } else if (step === REVIEW_STEP && !aiStepInserted) {
      setStep(TRADE_STEP);
    } else if (step === AI_STEP) {
      setStep(TRADE_STEP);
    } else if (step > 0) {
      setStep((s) => s - 1);
    } else {
      handleClose();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
      }}
    >
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <div
        style={{
          background: 'white',
          borderRadius: 14,
          width: 560,
          maxHeight: '92vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '24px 28px 0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: '#1B3A6B', fontWeight: 700 }}>
              Scope of Work &amp; Proposal
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#888' }}>
              Step {step + 1} of {STEPS.length} — {STEPS[step]}
            </p>
          </div>
          <button
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 22,
              cursor: 'pointer',
              color: '#aaa',
              lineHeight: 1,
              marginTop: -2,
            }}
          >
            ×
          </button>
        </div>

        {/* Draft restore banner */}
        {pendingDraft && (
          <div
            style={{
              margin: '12px 28px 0',
              background: '#eff6ff',
              border: '1px solid #93c5fd',
              borderRadius: 8,
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              fontSize: 13,
            }}
          >
            <span style={{ color: '#1e40af' }}>
              💾 You have a saved draft from{' '}
              {new Date(pendingDraft.savedAt).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
              . Resume where you left off?
            </span>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => restoreDraft(pendingDraft)}
                style={{
                  background: '#1B3A6B',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Resume
              </button>
              <button
                onClick={() => setPendingDraft(null)}
                style={{
                  background: 'white',
                  color: '#555',
                  border: '1px solid #ddd',
                  borderRadius: 6,
                  padding: '5px 10px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Start Fresh
              </button>
            </div>
          </div>
        )}

        {/* Progress bar */}
        <div style={{ padding: '16px 28px 0' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {STEPS.map((label, i) => (
              <div key={label} style={{ flex: 1 }}>
                <div
                  style={{
                    height: 4,
                    borderRadius: 2,
                    background: i <= step ? '#1B3A6B' : '#e5e7eb',
                    transition: 'background 0.2s',
                  }}
                />
                <div
                  style={{
                    fontSize: 10,
                    color: i === step ? '#1B3A6B' : '#bbb',
                    marginTop: 4,
                    fontWeight: i === step ? 700 : 400,
                    textAlign: 'center',
                  }}
                >
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Trade Selection step */}
        {step === TRADE_STEP ? (
          <TradeSelectionStep
            selectedTrades={selectedTrades}
            onToggleTrade={setSelectedTrades}
            onBack={handleBack}
            onNext={handleNextFromTrades}
            fetchingQuestions={fetchingQuestions}
            extractingFiles={extractingFiles}
            departments={departments}
          />
        ) : step === AI_STEP && aiStepInserted ? (
          <AIQuestionsStep
            questions={wizardQuestions}
            answers={wizardAnswers}
            onAnswer={setWizardAnswers}
            onBack={handleBack}
            onNext={handleQuestionsComplete}
          />
        ) : step === REVIEW_STEP ? (
          <ReviewStep
            contact={contact}
            address={address}
            scope={scope}
            budgetTarget={budgetTarget}
            selectedTrades={selectedTrades}
            answers={wizardAnswers}
            onBack={handleBack}
            onSubmit={submit}
            busy={busy}
            departments={departments}
          />
        ) : (
          <>
            {/* Standard step content */}
            <div style={{ padding: '24px 28px' }}>
              {/* Step 0 — Contact */}
              {step === 0 && (
                <div>
                  <div ref={nameRef} style={{ position: 'relative', marginBottom: 14 }}>
                    <label style={labelStyle}>Name *</label>
                    <input
                      autoFocus
                      value={contact.name}
                      onChange={(e) => handleNameChange(e.target.value)}
                      onFocus={() => contact.name.length >= 2 && setShowSuggestions(true)}
                      placeholder="e.g. John Smith"
                      style={inputStyle}
                    />
                    {showSuggestions && suggestions.length > 0 && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          right: 0,
                          background: 'white',
                          border: '1px solid #ddd',
                          borderRadius: 6,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                          zIndex: 10,
                          maxHeight: 200,
                          overflow: 'auto',
                        }}
                      >
                        {suggestions.map((c) => (
                          <div
                            key={c.id}
                            onMouseDown={() => applySuggestion(c)}
                            style={{
                              padding: '10px 14px',
                              cursor: 'pointer',
                              borderBottom: '1px solid #f0f0f0',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f8ff')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
                          >
                            <div style={{ fontWeight: 600, fontSize: 13, color: '#1B3A6B' }}>
                              {c.name}
                            </div>
                            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                              {[c.phone, c.email].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={labelStyle}>Phone</label>
                      <input
                        value={contact.phone}
                        onChange={(e) => setContact((p) => ({ ...p, phone: e.target.value }))}
                        placeholder="+1 555 000 0000"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Email</label>
                      <input
                        value={contact.email}
                        onChange={(e) => setContact((p) => ({ ...p, email: e.target.value }))}
                        placeholder="john@email.com"
                        type="email"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 1 — Job Address */}
              {step === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <p
                    style={{
                      margin: '0 0 4px',
                      fontSize: 11,
                      color: '#888',
                      background: '#f8faff',
                      border: '1px solid #dde4f5',
                      borderRadius: 6,
                      padding: '7px 10px',
                    }}
                  >
                    💡 You can skip this if you're uploading plans or blueprints in the next step —
                    the address will be read from the documents automatically.
                  </p>
                  <div>
                    <label style={labelStyle}>Street</label>
                    <input
                      autoFocus
                      value={address.street}
                      onChange={(e) => setAddress((p) => ({ ...p, street: e.target.value }))}
                      placeholder="123 Main St"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={labelStyle}>City *</label>
                      <input
                        value={address.city}
                        onChange={(e) => setAddress((p) => ({ ...p, city: e.target.value }))}
                        placeholder="Boston"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>State</label>
                      <input
                        value={address.state}
                        onChange={(e) => setAddress((p) => ({ ...p, state: e.target.value }))}
                        placeholder="MA"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Zip</label>
                      <input
                        value={address.zip}
                        onChange={(e) => setAddress((p) => ({ ...p, zip: e.target.value }))}
                        placeholder="02101"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2 — Scope of Work */}
              {step === 2 && (
                <div>
                  <label style={labelStyle}>Project Type</label>
                  <select
                    value={jobType}
                    onChange={(e) => setJobType(e.target.value)}
                    style={{ ...inputStyle, marginBottom: 14 }}
                  >
                    <option value="">— Select type (optional) —</option>
                    <option value="residential">Residential</option>
                    <option value="commercial">Commercial</option>
                    <option value="new_construction">New Construction</option>
                    <option value="renovation">Renovation</option>
                  </select>

                  <label style={labelStyle}>Scope of Work *</label>
                  <p style={{ fontSize: 12, color: '#777', margin: '0 0 8px' }}>
                    Describe the work — trades involved, rough scope, any specific materials?
                    (minimum 20 characters)
                  </p>
                  <textarea
                    autoFocus
                    rows={6}
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    placeholder={`e.g. Kitchen remodel — install new cabinets, countertops, tile backsplash\nNew LVP flooring throughout main level\nBathroom: new vanity, toilet, shower tile`}
                    style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                  />

                  {/* File attachment area */}
                  <div style={{ marginTop: 14 }}>
                    <label style={labelStyle}>
                      Attach Plans / Blueprints
                      <span style={{ fontWeight: 400, textTransform: 'none', color: '#999' }}>
                        {' '}
                        (optional — images or PDFs)
                      </span>
                    </label>
                    <p style={{ fontSize: 11, color: '#888', margin: '0 0 8px' }}>
                      Upload building plans, blueprints, sketches, or photos — AI will read them and
                      pull measurements, materials, and scope details automatically.
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const newFiles = Array.from(e.target.files || []);
                        setAttachedFiles((prev) => {
                          const names = new Set(prev.map((f) => f.name));
                          return [...prev, ...newFiles.filter((f) => !names.has(f.name))];
                        });
                        e.target.value = '';
                      }}
                    />
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.borderColor = '#1B3A6B';
                        e.currentTarget.style.background = '#f0f4ff';
                      }}
                      onDragLeave={(e) => {
                        e.currentTarget.style.borderColor = '#c5d0e8';
                        e.currentTarget.style.background = '#f8faff';
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.borderColor = '#c5d0e8';
                        e.currentTarget.style.background = '#f8faff';
                        const dropped = Array.from(e.dataTransfer.files).filter(
                          (f) => f.type.startsWith('image/') || f.type === 'application/pdf',
                        );
                        setAttachedFiles((prev) => {
                          const names = new Set(prev.map((f) => f.name));
                          return [...prev, ...dropped.filter((f) => !names.has(f.name))];
                        });
                      }}
                      style={{
                        border: '2px dashed #c5d0e8',
                        borderRadius: 8,
                        background: '#f8faff',
                        padding: '14px 16px',
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: 22, marginBottom: 4 }}>📎</div>
                      <div style={{ fontSize: 12, color: '#555', fontWeight: 600 }}>
                        Click or drag files here
                      </div>
                      <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                        JPG, PNG, PDF · Multiple files OK
                      </div>
                    </div>

                    {attachedFiles.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {attachedFiles.map((f, i) => (
                          <div
                            key={i}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              background: '#e8f0fe',
                              borderRadius: 20,
                              padding: '4px 10px',
                              fontSize: 11,
                              color: '#1B3A6B',
                              fontWeight: 600,
                            }}
                          >
                            <span>{f.type.startsWith('image/') ? '🖼️' : '📄'}</span>
                            <span
                              style={{
                                maxWidth: 140,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {f.name}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setAttachedFiles((prev) => prev.filter((_, j) => j !== i));
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#666',
                                fontSize: 13,
                                lineHeight: 1,
                                padding: 0,
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {extractingFiles && (
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 12,
                          color: '#1B3A6B',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-block',
                            width: 12,
                            height: 12,
                            border: '2px solid #1B3A6B',
                            borderTopColor: 'transparent',
                            borderRadius: '50%',
                            animation: 'spin 0.7s linear infinite',
                          }}
                        />
                        Reading files…
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <label style={labelStyle}>
                      Budget Target{' '}
                      <span style={{ fontWeight: 400, textTransform: 'none', color: '#999' }}>
                        (optional — soft target, AI can go ±8%)
                      </span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <span
                        style={{
                          position: 'absolute',
                          left: 10,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          color: '#555',
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        $
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={budgetTarget}
                        onChange={(e) => setBudgetTarget(e.target.value.replace(/[^0-9,]/g, ''))}
                        placeholder="e.g. 150,000"
                        style={{ ...inputStyle, paddingLeft: 22 }}
                      />
                    </div>
                    <p style={{ fontSize: 11, color: '#aaa', margin: '4px 0 0' }}>
                      If set, AI will calibrate line items to reach this client-facing total.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer navigation for standard steps */}
            <div
              style={{
                padding: '0 28px 24px',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <button
                onClick={step === 0 ? handleClose : () => setStep((s) => s - 1)}
                style={{
                  padding: '10px 20px',
                  border: '1px solid #ddd',
                  borderRadius: 6,
                  background: 'white',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: '#555',
                }}
              >
                {step === 0 ? 'Cancel' : '← Back'}
              </button>

              {prefillLead?.id && (
                <div
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
                >
                  <button
                    onClick={saveDraft}
                    disabled={draftSaving}
                    style={{
                      padding: '10px 16px',
                      border: '1px solid #93c5fd',
                      borderRadius: 6,
                      background: draftSaving ? '#f0f4ff' : '#eff6ff',
                      color: '#1e40af',
                      cursor: draftSaving ? 'default' : 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {draftSaving ? 'Saving…' : '💾 Save Draft'}
                  </button>
                  {lastAutoSave && (
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>
                      Auto-saved{' '}
                      {Math.max(1, Math.round((Date.now() - lastAutoSave.getTime()) / 60000))} min
                      ago
                    </span>
                  )}
                </div>
              )}

              {step === 2 ? (
                <button
                  onClick={handleNextFromScope}
                  disabled={!canNext()}
                  style={{
                    padding: '10px 24px',
                    borderRadius: 6,
                    border: 'none',
                    background: !canNext() ? '#c5ccd8' : '#1B3A6B',
                    color: 'white',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: !canNext() ? 'not-allowed' : 'pointer',
                  }}
                >
                  Next →
                </button>
              ) : (
                <button
                  onClick={() => setStep((s) => s + 1)}
                  disabled={!canNext()}
                  style={{
                    padding: '10px 24px',
                    borderRadius: 6,
                    border: 'none',
                    background: canNext() ? '#1B3A6B' : '#c5ccd8',
                    color: 'white',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: canNext() ? 'pointer' : 'not-allowed',
                  }}
                >
                  Next →
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Build serializable payload for selectedTrades (array of {id, name, deptName, meaning})
function buildSelectedTradesPayload(selectedTrades, departments = DEPARTMENTS_FALLBACK) {
  if (!selectedTrades || selectedTrades.size === 0) return [];
  const result = [];
  for (const dept of departments) {
    for (const sub of dept.subDepartments) {
      if (selectedTrades.has(sub.id)) {
        result.push({ id: sub.id, name: sub.name, deptName: dept.name, meaning: sub.meaning });
      }
    }
  }
  return result;
}
