export default function Loading() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      gap: '1rem',
      color: '#94a3b8'
    }}>
      <div style={{
        width: '2.5rem',
        height: '2.5rem',
        border: '3px solid rgba(22, 163, 74, 0.2)',
        borderTopColor: '#22c55e',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite'
      }} />
      <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Loading educational content...</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
