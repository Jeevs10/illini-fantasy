export default function Sent() {
  return (
    <div className="narrow">
      <div className="panel"><div className="panel-body">
        <h1>Check your email</h1>
        <p className="muted">
          A sign-in link is on its way. It works once and expires in 24 hours.
        </p>
        <p className="faint" style={{ fontSize: ".85rem" }}>
          Running locally without mail credentials? The link is printed in the
          server log instead.
        </p>
      </div>
    </div></div>
  );
}
