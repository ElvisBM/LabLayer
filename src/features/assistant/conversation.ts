export type Clarification = { message: string; question: string; requestId?: string };

// Only offer a yes button for a single, explicit confirmation question.
// Questions about quantities, alternatives or missing information need a written answer.
export function canConfirmQuestion(question: string) {
  return /^(?:você\s+)?(?:autoriza|confirma|aprova)\s+[^?]+\?$/i.test(question.trim())
    && !/\b(?:ou|qual|quais|quanto|quantos|quando)\b/i.test(question);
}

export function clarificationMessage(context: Clarification, reply: string) {
  return `${context.message}\n\nPergunta do assistente:\n${context.question}\n\nResposta do vendedor:\n${reply}`;
}
