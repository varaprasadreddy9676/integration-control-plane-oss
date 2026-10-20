const FAQS: Array<{ q: string; a: string }> = [
  {
    q: 'Is it free to use?',
    a: 'Yes. It is licensed under AGPL v3: you can self-host it, modify it and use it commercially at no cost. If you offer a modified version to others as a network service, you must publish your changes under the same license.',
  },
  {
    q: 'What does it need to run?',
    a: 'Docker Compose, or Node.js 24+ with MongoDB 7.0+. MySQL and Kafka are optional and only needed if you use them as event sources.',
  },
  {
    q: 'Can it serve many customers from one installation?',
    a: 'Yes. Every integration, credential, log and user belongs to an organization, and organizations can be nested. Roles decide what each person or API key can see and change.',
  },
  {
    q: 'What happens when a destination is down?',
    a: 'Deliveries retry with backoff. When retries run out they move to the dead-letter queue, where you can inspect each failure and replay one or all of them once the destination recovers.',
  },
  {
    q: 'Does it support healthcare messaging?',
    a: 'Yes. HL7 v2 over MLLP works both as an event source and as a destination, with JSON-to-HL7 and HL7-to-JSON conversion and ACK/NACK handling.',
  },
  {
    q: 'Does the MCP server send my data to an AI provider?',
    a: 'No. The gateway contains no model. The MCP server exposes tools to the client you choose, using an API key with the permissions you grant.',
  },
];

export default function FaqSection() {
  return (
    <section id="faq" className="pl-section">
      <div className="pl-wrap">
        <div className="pl-head">
          <h2>Questions teams ask first.</h2>
        </div>
        <div className="faq">
          {FAQS.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p className="faq-answer">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
