export interface Question {
  id: string;
  text: string;
  personaId: string;
}

const questionsByPersona: Record<string, string[]> = {
  developer: [
    "What exactly needs to be built for this feature?",
    "What's the status of the payment integration?",
    "How does the offline store-and-forward system work?",
    "What are the performance targets for order latency?",
    "What technical decisions have been made and why?",
  ],
  "product-manager": [
    "What is the current status of the PlateOS MVP?",
    "What's in scope for MVP vs deferred to Phase 2?",
    "What did the customer research reveal?",
    "What are the open questions and blockers?",
    "Who owns what part of this project?",
  ],
  executive: [
    "Is the December 1 launch still on track?",
    "What are the key risks to the MVP timeline?",
    "How do we compare to Lightspeed, Square, and Toast?",
    "What decision do you need from me?",
    "What's the status of our pilot restaurants?",
  ],
  sales: [
    "How do I explain PlateOS to restaurant owners?",
    "What should I NOT promise to prospects?",
    "What competitive advantages does PlateOS have?",
    "When will the MVP be generally available?",
    "What problems does PlateOS solve for restaurants?",
  ],
  marketing: [
    "What's the customer value proposition for PlateOS?",
    "What pain points did the research uncover?",
    "What are the key talking points for launch?",
    "Who should we target with our messaging?",
    "What differentiates us from existing POS systems?",
  ],
  "customer-support": [
    "How does the order and payment flow work?",
    "What happens when the internet goes down?",
    "What features are NOT in the MVP?",
    "How do split payments work?",
    "What should I tell restaurants asking about online ordering?",
  ],
  "customer-success": [
    "What's the status of each pilot restaurant?",
    "What pain points are pilots experiencing?",
    "How do I explain the roadmap to pilot customers?",
    "What training is needed for restaurant staff?",
    "When will multi-venue support be available?",
  ],
  "technical-services": [
    "What are the technical requirements and dependencies?",
    "How does the offline mode architecture work?",
    "What monitoring and alerts should I set up?",
    "What's the performance impact and scalability plan?",
    "What are the deployment and infrastructure requirements?",
  ],
  legal: [
    "What are the PCI-DSS compliance requirements?",
    "What data privacy considerations exist for payments?",
    "What are the Australian Privacy Act obligations?",
    "What GST reporting requirements must we meet?",
    "What contracts are needed for pilot restaurants?",
  ],
  design: [
    "Why was tablet-first chosen over mobile?",
    "What user research informed the design decisions?",
    "How should the split payment flow work?",
    "What's the target for new staff training time?",
    "What's the design system for the real-time dashboard?",
  ],
};

export function getQuestionsForPersona(personaId: string): Question[] {
  const texts = questionsByPersona[personaId] || [];
  return texts.map((text, index) => ({
    id: `${personaId}-q${index + 1}`,
    text,
    personaId,
  }));
}
