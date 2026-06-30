import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, PenLine, Send, Sparkles } from 'lucide-react';
import useBrandKitStore from '../../stores/BrandKitStore';
import { callGroqJSON } from '../../services/groqClient';
import {
  CONVERSATION_QUESTIONS,
  buildFinalConversationInferencePrompt,
  normalizeConversationResult,
} from '../../services/brandKitConversation';
import BrandKitLivePreview from './BrandKitLivePreview';

export default function BrandKitConversation({
  onComplete,
  initialMissingFields = [],
  prefilled = {},
}) {
  const [questionIdx, setQuestionIdx] = useState(0);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [collectedData, setCollectedData] = useState(prefilled || {});
  const [confidenceMap, setConfidenceMap] = useState({});
  const chatEndRef = useRef(null);
  const setExtractedDraft = useBrandKitStore((state) => state.setExtractedDraft);

  const introText = useMemo(() => {
    const firstQuestion = CONVERSATION_QUESTIONS[0];
    if (prefilled && Object.keys(prefilled).length > 0) {
      if (Array.isArray(initialMissingFields) && initialMissingFields.length > 0) {
        return `I already extracted some details. I will complete the missing fields next.\n\n${firstQuestion}`;
      }
      return `I already extracted some details from your document.\n\n${firstQuestion}`;
    }
    return firstQuestion;
  }, [initialMissingFields, prefilled]);

  const addAiMessage = (text) => setMessages((prev) => [...prev, { role: 'ai', text }]);
  const addUserMessage = (text) => setMessages((prev) => [...prev, { role: 'user', text }]);

  useEffect(() => {
    setMessages([{ role: 'ai', text: introText }]);
  }, [introText]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const finalizeConversation = async (nextAnswers) => {
    const prompt = buildFinalConversationInferencePrompt({
      answers: nextAnswers,
      prefilled: collectedData,
    });

    const result = await callGroqJSON(prompt, {
      system: 'Return only valid JSON for the requested schema.',
      temperature: 0.2,
      max_tokens: 1400,
    });

    const normalized = normalizeConversationResult(result, collectedData);
    setCollectedData(normalized.brandKit);
    setConfidenceMap(normalized.confidenceMap);
    setExtractedDraft(normalized.brandKit, normalized.confidenceMap, normalized.missingTier1Fields);
    addAiMessage('You are all set. Review your Brand Kit on the next screen and make any edits you need.');
    await new Promise((resolve) => setTimeout(resolve, 500));
    onComplete?.(normalized.brandKit, normalized.confidenceMap);
  };

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isThinking) return;

    const nextAnswers = [...answers, text];
    setInputValue('');
    setAnswers(nextAnswers);
    addUserMessage(text);

    if (questionIdx < CONVERSATION_QUESTIONS.length - 1) {
      const nextIdx = questionIdx + 1;
      setQuestionIdx(nextIdx);
      addAiMessage(CONVERSATION_QUESTIONS[nextIdx]);
      return;
    }

    setIsThinking(true);
    try {
      await finalizeConversation(nextAnswers);
    } catch (err) {
      addAiMessage(`I could not process the conversation: ${err?.message || 'Unknown error'}. Please try again.`);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div className="bk-conversation-layout">
      <div className="bk-chat-panel">
        <div className="bk-chat-header">
          <span className="bk-chat-section-label">
            Question {Math.min(questionIdx + 1, CONVERSATION_QUESTIONS.length)} of {CONVERSATION_QUESTIONS.length}
          </span>
          <button
            className="bk-link bk-chat-manual-link"
            onClick={() => onComplete?.(collectedData, confidenceMap)}
            type="button"
          >
            <PenLine size={13} />
            Edit manually
          </button>
        </div>

        <div className="bk-chat-messages" role="log" aria-label="Brand Kit setup conversation">
          {messages.map((msg, index) => (
            <div key={`${msg.role}-${index}`} className={`bk-chat-bubble ${msg.role}`}>
              {msg.role === 'ai' && (
                <div className="bk-chat-ai-avatar" aria-hidden="true"><Sparkles size={12} /></div>
              )}
              <div className="bk-chat-bubble-text">{msg.text}</div>
            </div>
          ))}

          {isThinking && (
            <div className="bk-chat-bubble ai">
              <div className="bk-chat-ai-avatar" aria-hidden="true"><Sparkles size={12} /></div>
              <div className="bk-chat-thinking" aria-label="AI is thinking">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="bk-chat-input-area">
          <textarea
            className="bk-chat-input"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type your answer..."
            rows={3}
            disabled={isThinking}
            aria-label="Your answer"
          />

          <button
            className="bk-chat-send-btn"
            onClick={handleSend}
            disabled={!inputValue.trim() || isThinking}
            aria-label="Send"
            type="button"
          >
            {isThinking ? <Loader2 size={16} className="bk-spin" /> : <Send size={16} />}
          </button>
        </div>

        <div className="bk-chat-progress" aria-label={`Question ${Math.min(questionIdx + 1, CONVERSATION_QUESTIONS.length)} of ${CONVERSATION_QUESTIONS.length}`}>
          {CONVERSATION_QUESTIONS.map((question, index) => (
            <span
              key={question}
              className={`bk-progress-dot ${index < questionIdx ? 'done' : index === questionIdx ? 'active' : ''}`}
            />
          ))}
        </div>
      </div>

      <div className="bk-conversation-preview">
        <BrandKitLivePreview data={collectedData} confidenceMap={confidenceMap} />
      </div>
    </div>
  );
}

