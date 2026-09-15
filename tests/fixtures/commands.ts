/** SYNTHETIC commands.catalog envelope, checked against Hermes b6b53c6 methods_tools.py. */
export function commandFixture(profile = 'default') {
  const pairs = [
    ['/help', 'Show available commands'], ['/model', 'Switch model'], ['/profile', 'Show active profile'],
    ['/reasoning', 'Manage reasoning effort'], ['/context', 'View context usage'], ['/usage', 'Show token usage'],
    ['/status', 'Show live session status'], ['/history', 'Show conversation history'],
    ['/undo', 'Undo a turn'], ['/compress', 'Compress context'],
    [`/${profile}-skill`, 'A profile-owned skill'], ['/unsafe', 'An unverified quick command'],
    ['/queue', 'Queue a prompt for the next turn'],
  ];
  return { pairs, canon: Object.fromEntries([...pairs.map(([name]) => [name, name]), ['/h', '/help']]),
    categories: [{ name: 'Session', pairs: pairs.slice(0, 10) }, { name: 'User commands', pairs: [pairs[11]] }],
    skills: { [`/${profile}-skill`]: { usage: 1, origin: 'local' } }, commands: {}, sub: {}, warning: '' };
}
