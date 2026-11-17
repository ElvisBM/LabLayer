import {expect,it} from 'vitest';
import {requestCode,withoutRequestCode} from '../../shared/requests/number';
it('normaliza número e prefixo uma única vez, mantendo códigos legados',()=>{
 expect(requestCode({requestNumber:15})).toBe('ORC-015');
 expect(requestCode({requestNumber:'ORC-015'})).toBe('ORC-015');
 expect(requestCode({title:'ORC 007 — Nome'})).toBe('ORC-007');
 expect(withoutRequestCode('ORC-007 — Nome')).toBe('Nome');
 expect(requestCode({title:'Medalhas',id:'bot-a'})).toBeUndefined();
 expect(requestCode({code:'ORC-1001'})).toBe('ORC-1001');
});
