// Figures from the project's baseline benchmark (see the performance docs).
export default function NumbersSection() {
  return (
    <section id="performance" className="pl-section">
      <div className="pl-wrap">
        <div className="pl-head">
          <h2>Measured, not promised.</h2>
          <p className="pl-lead">
            One backend instance and one MongoDB, under sustained load. Choose per integration whether you want a full
            trace of every request or maximum throughput.
          </p>
        </div>
        <div className="nums">
          <div className="num">
            <span className="num-value">
              120<span className="num-unit">requests/s</span>
            </span>
            <span className="num-label">With full audit logging</span>
            <span className="num-note">Measured at 110 to 130. Plan for about 100 per instance.</span>
          </div>
          <div className="num">
            <span className="num-value">
              1,300+<span className="num-unit">requests/s</span>
            </span>
            <span className="num-label">In performance logging mode</span>
            <span className="num-note">Minimal logging, for high-volume routes. Plan for about 1,200.</span>
          </div>
        </div>
        <p className="nums-method">
          Benchmark: a 20-second sustained run with up to 100 concurrent clients against a single instance. Keep 30–40%
          headroom, and scale horizontally beyond that; millions of requests a day with full audit logging needs more
          than one instance.
        </p>
      </div>
    </section>
  );
}
