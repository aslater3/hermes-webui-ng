import { useRef, useState } from 'react';
import { ArrowRight, ShieldCheck, Settings2 } from 'lucide-react';
import type { AppRuntime } from './runtime.js';
import { Brand, Notice } from './primitives.js';

export function SignIn({ runtime: rt, onSettings }: { runtime: AppRuntime; onSettings: () => void }) {
  const state = rt.connection.state, providers = rt.connection.providers.filter(provider => provider.supports_password);
  const password = useRef<HTMLInputElement>(null), username = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState('');
  const provider = providers.some(item => item.name === selected) ? selected : providers[0]?.name || '';
  const error = rt.error || state.error?.message;
  return <div className="signin-layout"><div className="signin-top"><Brand/><button className="text-button" onClick={onSettings}><Settings2 size={16}/>Connection settings</button></div><main className="signin-main"><div className="signin-card"><span className="eyebrow">YOUR AGENT. YOUR WORKSPACE.</span><h1>A little less friction.<br/>A lot more possibility.</h1><p className="signin-intro">Connect to Hermes and pick up where you left off.</p>
    <form onSubmit={event => { event.preventDefault(); const value = password.current?.value ?? '', name = username.current?.value ?? ''; if (password.current) password.current.value = ''; rt.run(() => rt.connection.login(provider, name, value)); }}>
      {providers.length > 1 && <label className="field">Sign-in provider<select value={provider} onChange={event => setSelected(event.target.value)}>{providers.map(item => <option key={item.name} value={item.name}>{item.display_name}</option>)}</select></label>}
      <label className="field">Username<input ref={username} autoComplete="username" placeholder="Your Hermes username" required disabled={state.busy}/></label>
      <label className="field">Password<input ref={password} type="password" autoComplete="current-password" placeholder="Enter your password" required disabled={state.busy}/></label>
      {error && <Notice error>{error}</Notice>}
      <button className="primary signin-submit" disabled={state.busy || state.offline || !provider || state.auth === 'checking'}>{state.busy ? 'Connecting…' : 'Sign in'}<ArrowRight size={18}/></button>
      {state.rest === 'checking' && <p role="status" className="muted small">Checking your Hermes connection…</p>}
      {!providers.length && state.rest === 'healthy' && <Notice>No password provider is advertised by Hermes. OAuth is not available in this build.</Notice>}
      {state.offline && <Notice>You’re offline. Reconnect to sign in.</Notice>}
    </form><p className="signin-trust"><ShieldCheck size={15}/>Authentication stays with your Hermes installation.</p></div></main><footer className="signin-footer">A focused space to think, build and get things done.</footer></div>;
}
