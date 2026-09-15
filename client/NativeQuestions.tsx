import { useState } from 'react';
import type { PeerRequest, PeerRequests } from '../src/hermes/peer-requests.js';
import { ClientError } from '../src/hermes/protocol.js';
import { Notice } from './primitives.js';
import './native-questions.css';

function QuestionCard({ request, requests, current, onError }: { request: PeerRequest; requests: PeerRequests; current: () => boolean; onError: (error: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [value, setValue] = useState(''), [identifier, setIdentifier] = useState(''), [error, setError] = useState('');
  const send = (choice?: string, cancel = false) => {
    if (!current()) return;
    const answer = request.kind === 'approval' ? { choice } : request.kind === 'clarify' ?
      request.batch ? { answers } : { answer: answers.answer ?? '' } :
      { value: request.kind === 'login' ? JSON.stringify({ identifier, password: value }) : value };
    setValue(''); setIdentifier(''); setAnswers({});
    try { requests.respond(request, answer, cancel); }
    catch (reason) { const message = reason instanceof ClientError ? reason.message : 'The answer could not be sent. Check native state before trying again.'; setError(message); onError(message); }
  };
  const label = (choice: string) => ({ once: 'Approve once', session: 'Approve for session', always: 'Always approve', deny: 'Deny' })[choice] ?? choice;
  return <article className="native-question" aria-label={request.title}>
    <h3>{request.title}</h3>
    {request.detail && <pre className="native-question-detail" role="region" tabIndex={0} aria-label="Native request details">{request.detail}</pre>}
    {error && <Notice error>{error}</Notice>}
    {request.kind === 'approval' ? <div className="native-question-actions">
      {request.choices.filter(choice => choice !== 'deny').map(choice => <button className="secondary" type="button" key={choice} onClick={() => send(choice)}>{label(choice)}</button>)}
      <button className="secondary" type="button" onClick={() => send('deny', true)}>Deny</button>
    </div> : <form onSubmit={event => { event.preventDefault(); send(); }}>
      {request.kind === 'clarify' ? request.questions.map(q => <fieldset key={q.id} disabled={q.locked !== undefined}>
        <legend>{q.text}</legend>
        {q.locked !== undefined ? <p>Answer locked in Hermes: {q.locked}</p> : <>
          {q.choices.map(choice => <label className="native-choice" key={choice}>
            <input type={q.multiple ? 'checkbox' : 'radio'} name={`${request.id}-${q.id}`} value={choice}
              checked={q.multiple ? (answers[q.id] ?? '').split('\n').includes(choice) : answers[q.id] === choice}
              onChange={event => setAnswers(previous => ({ ...previous, [q.id]: q.multiple ?
                (event.target.checked ? [...(previous[q.id] ?? '').split('\n').filter(Boolean), choice] :
                  (previous[q.id] ?? '').split('\n').filter(item => item !== choice)).join('\n') : choice }))}/>{choice}
          </label>)}
          <label className="field">{q.choices.length ? 'Answer or other response' : 'Your answer'}
            <textarea rows={2} maxLength={32768} value={answers[q.id] ?? ''} onChange={event => setAnswers(previous => ({ ...previous, [q.id]: event.target.value }))}/>
          </label>
        </>}
      </fieldset>) : <>
        {request.kind === 'login' && <label className="field">Login identifier<input autoComplete="off" value={identifier} maxLength={4096} onChange={event => setIdentifier(event.target.value)}/></label>}
        <label className="field">{request.kind === 'login' ? 'Password' : request.title}
          <input type="password" autoComplete="off" maxLength={16384} value={value} onChange={event => setValue(event.target.value)}/>
        </label>
        <p className="small muted">Sent only to the current native Hermes request. Not saved in this browser.</p>
      </>}
      <div className="native-question-actions"><button type="submit" className="primary">Send answer to Hermes</button>
        <button type="button" className="secondary" onClick={() => send(undefined, true)}>Decline request</button></div>
    </form>}
  </article>;
}

export function NativeQuestions({ rows, requests, current, onError }: { rows: readonly PeerRequest[]; requests: PeerRequests; current: () => boolean; onError: (error: string) => void }) {
  return rows.length ? <section data-native-requests className="native-questions" aria-label="Native interactive requests">
    {rows.map(request => <QuestionCard key={request.id} request={request} requests={requests} current={current} onError={onError}/>)}
  </section> : null;
}
