import { Component } from 'react'

// A failed texture or a malformed world used to leave the canvas painted
// near-black with no way out. Now it says what happened and offers the door.
export default class ErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err) { console.error('[audora] viewer crashed:', err) }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="crash">
        <div className="crash-t">This world could not be displayed.</div>
        <div className="crash-s">{String(this.state.err.message || this.state.err)}</div>
        <div className="crash-a">
          <button onClick={() => { this.setState({ err: null }); this.props.onRecover?.() }}>
            Open the last good room
          </button>
          <button className="ghosty" onClick={() => { this.setState({ err: null }); this.props.onHome?.() }}>
            Back to home
          </button>
        </div>
      </div>
    )
  }
}
