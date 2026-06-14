#!/usr/bin/env node
'use strict';

// PreToolUse: Bash — Git safety, bd validation, epic close checks
// Consolidated from: validate-epic-close + block-orchestrator-tools (Bash logic)

const {
  readStdinJSON, getField, deny, isSubagent,
  execCommand, execCommandJSON, runHook,
} = require('./hook-utils.cjs');

// Split a command line into shell segments and drop each segment's leading
// VAR=value env assignments, so a guard keyed on "git"/"bd" still fires for
// "  git …", "X=1 git …", "/usr/bin/git …", or "cd x && git commit --no-verify".
// ponytail: token-level denylist — it does NOT defeat eval / quoting / $()
// obfuscation; swap in a real shell parser if that ever becomes a threat.
function segmentTokens(command) {
  return String(command)
    .split(/&&|\|\||[;|\n]/)
    .map((seg) => {
      const tokens = seg.trim().split(/\s+/).filter(Boolean);
      let i = 0;
      while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
      return tokens.slice(i);
    })
    .filter((t) => t.length > 0);
}

// Command "verb" (basename, path stripped) of every segment.
function commandVerbs(command) {
  return segmentTokens(command).map((t) => t[0].replace(/^.*\//, ''));
}

// The first shell segment whose verb is `verb`, rejoined as "verb arg1 …" (or '').
function commandSegment(command, verb) {
  for (const t of segmentTokens(command)) {
    if (t[0].replace(/^.*\//, '') === verb) return t.join(' ');
  }
  return '';
}

runHook('bash-guard', () => {
  const input = readStdinJSON();

  // Subagents get full access
  if (isSubagent(input)) process.exit(0);

  // Get command — prefer env var (original behavior), fall back to stdin
  let toolInput;
  try {
    toolInput = process.env.CLAUDE_TOOL_INPUT
      ? JSON.parse(process.env.CLAUDE_TOOL_INPUT)
      : getField(input, 'tool_input') || {};
  } catch {
    toolInput = getField(input, 'tool_input') || {};
  }

  const command = toolInput.command || '';
  const verbs = commandVerbs(command);

  // === Git safety checks ===
  if (verbs.includes('git')) {
    if (command.includes('--no-verify') || /\bcommit\b.*\s-n\b/.test(command)) {
      deny(
        'git commit --no-verify is blocked.\n\n' +
        'Pre-commit hooks exist for a reason (type-check, lint, tests).\n' +
        'Run the commit without --no-verify and fix any issues.'
      );
    }
  }

  // === bd validation ===
  // Parse the bd segment specifically (not the whole line) so chained commands
  // like "git push && bd create x" are validated correctly.
  const bdSeg = commandSegment(command, 'bd');
  if (bdSeg) {
    const parts = bdSeg.split(/\s+/);
    const subCmd = parts[1] || '';

    // bd create must have description
    if (subCmd === 'create' || subCmd === 'new') {
      if (!bdSeg.includes('-d ') && !bdSeg.includes('--description ') && !bdSeg.includes('--description=')) {
        deny('bd create requires description (-d or --description) for supervisor context.');
      }
    }

    // === Epic close validation ===
    if (subCmd === 'close') {
      if (/--force/.test(bdSeg)) process.exit(0);

      const closeMatch = bdSeg.match(/bd\s+close\s+([A-Za-z0-9._-]+)/);
      if (!closeMatch) process.exit(0);
      const closeId = closeMatch[1];

      // CHECK 1: PR merge validation
      const branch = `bd-${closeId}`;
      const hasRemote = execCommand('git', ['remote', 'get-url', 'origin']);

      if (hasRemote) {
        const remoteBranch = execCommand('git', ['ls-remote', '--heads', 'origin', branch]);
        if (remoteBranch) {
          const mergedPr = execCommand('gh', [
            'pr', 'list', '--head', branch, '--state', 'merged',
            '--json', 'number', '--jq', '.[0].number',
          ]);
          if (!mergedPr) {
            deny(
              `Cannot close bead '${closeId}' — branch '${branch}' has no merged PR. ` +
              `Create and merge a PR first, or use 'bd close ${closeId} --force' to override.`
            );
          }
        }
      }

      // CHECK 2: Epic children validation
      const beadData = execCommandJSON('bd', ['show', closeId, '--json']);
      const issueType = beadData && beadData[0] ? (beadData[0].issue_type || '') : '';

      if (issueType === 'epic') {
        // Children are linked by parent relationship, not by a dotted id prefix
        // (bd ids are flat, e.g. delivery-tracker-v2-x45). Use bd's own parent
        // model; 'bd children' includes closed issues so we filter ourselves.
        const children = execCommandJSON('bd', ['children', closeId, '--json']);
        const childArr = Array.isArray(children)
          ? children
          : (children && Array.isArray(children.issues) ? children.issues : []);
        const incomplete = childArr.filter(
          (b) => b.id && b.status !== 'done' && b.status !== 'closed'
        );
        if (incomplete.length > 0) {
          const list = incomplete.map((b) => `${b.id} (${b.status})`).join(', ');
          deny(
            `Cannot close epic '${closeId}' - has ${incomplete.length} incomplete children: ${list}. ` +
            'Mark all children as done first.'
          );
        }
      }
    }
  }

  // Allow everything else
  process.exit(0);
});
