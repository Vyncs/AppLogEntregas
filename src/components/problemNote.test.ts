import { describe, expect, it } from 'vitest';
import type { DeliveryPackage } from '../types/package';
import { problemNote } from './ProblemDialog';

const base = { status: 'problem', history: [] } as unknown as DeliveryPackage;

describe('problemNote', () => {
  it('é a observação do último "com problema" do histórico', () => {
    const pkg = {
      ...base,
      history: [
        { status: 'problem', at: '1', note: 'Local fechado' },
        { status: 'pending', at: '2' },
        { status: 'problem', at: '3', note: 'Destinatário ausente' },
      ],
    } as DeliveryPackage;
    expect(problemNote(pkg)).toBe('Destinatário ausente');
  });

  it('só vale enquanto a encomenda está com problema', () => {
    const pkg = { ...base, status: 'pending', history: [{ status: 'problem', at: '1', note: 'Local fechado' }] } as DeliveryPackage;
    expect(problemNote(pkg)).toBeNull();
  });
});
