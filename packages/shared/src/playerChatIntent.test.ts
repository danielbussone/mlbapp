import { describe, expect, it } from 'vitest';
import {
  extractPlayerCardChatIntentFromMessage,
  inferPlayerNameQueryFromUserMessageShared,
} from './playerChatIntent.js';

describe('extractPlayerCardChatIntentFromMessage', () => {
  it('matches tell me about', () => {
    const r = extractPlayerCardChatIntentFromMessage('Tell me about Mookie Betts');
    expect(r?.nameQuery).toBe('Mookie Betts');
  });

  it('matches talk about', () => {
    const r = extractPlayerCardChatIntentFromMessage('Talk about Shohei Ohtani');
    expect(r?.nameQuery).toBe('Shohei Ohtani');
  });

  it('matches bare two-word name', () => {
    const r = extractPlayerCardChatIntentFromMessage('Mike Trout');
    expect(r?.nameQuery).toBe('Mike Trout');
  });

  it('strips possessive role before year for deGrom-style prompts', () => {
    const r = extractPlayerCardChatIntentFromMessage("Tell me about Jacob deGrom's pitching in 2018");
    expect(r?.nameQuery).toBe('Jacob deGrom');
    expect(r?.explicitSeason).toBe(2018);
  });

  it('strips possessive batting for Ohtani-style prompts', () => {
    const r = extractPlayerCardChatIntentFromMessage('Tell me about Shohei Ohtani’s batting in 2021');
    expect(r?.nameQuery).toBe('Shohei Ohtani');
    expect(r?.explicitSeason).toBe(2021);
  });

  it('does not treat stat question as bare name', () => {
    expect(extractPlayerCardChatIntentFromMessage('What is WAR')).toBeNull();
  });

  it('does not treat compare-style line as bare name', () => {
    expect(extractPlayerCardChatIntentFromMessage('Mike Trout and Shohei Ohtani')).toBeNull();
  });
});

describe('inferPlayerNameQueryFromUserMessageShared', () => {
  it('returns resolve … and first segment', () => {
    const q = inferPlayerNameQueryFromUserMessageShared('resolve Mike Trout and compare');
    expect(q).toBe('Mike Trout');
  });
});
