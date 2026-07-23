import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import {
  connectWallet,
  CONTRACT_ID,
  disconnectWallet,
  ensureReadAccount,
  fetchContractEvents,
  fetchPolls,
  fetchVoteStatuses,
  getExplorerLink,
  NETWORK_PASSPHRASE,
  RPC_URL,
  submitContractTransaction,
  SUPPORTED_WALLET_NAMES,
} from './lib/stellar'
import { readCachedPolls, removeCachedPoll, writeCachedPolls } from './lib/pollCache'
import { getPollState, mergeRecentEvents, parsePollHash } from './lib/pollLogic'

const EMPTY_FORM = {
  question: '',
  options: ['', ''],
  duration: 60,
}

const DURATION_PRESETS = [5, 15, 30, 60, 180, 1440]

function shortenAddress(address) {
  if (!address) return 'Not connected'
  return `${address.slice(0, 6)}...${address.slice(-6)}`
}

function formatDateTime(timestamp) {
  if (!timestamp) return 'Waiting for sync'
  return new Date(timestamp).toLocaleString()
}

function formatEventTime(timestamp) {
  if (!timestamp) return 'Pending ledger timestamp'
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatTimeLeft(expiresAt) {
  const diff = expiresAt - Date.now()
  if (diff <= 0) return 'Closed'

  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ${hours % 24}h left`
  if (hours > 0) return `${hours}h ${minutes % 60}m left`
  return `${minutes}m left`
}

function getVoteActionState({ poll, walletAddress, hasVoted, transactionPhase, isWalletBusy }) {
  if (!walletAddress) {
    return {
      label: isWalletBusy ? 'Opening wallets...' : 'Connect wallet to vote',
      disabled: isWalletBusy,
      action: 'connect',
    }
  }

  if (getPollState(poll) === 'closed') {
    return {
      label: 'Poll closed',
      disabled: true,
      action: 'closed',
    }
  }

  if (hasVoted) {
    return {
      label: 'Already voted',
      disabled: true,
      action: 'voted',
    }
  }

  if (['preparing', 'awaiting-signature', 'pending'].includes(transactionPhase)) {
    return {
      label: 'Submitting...',
      disabled: true,
      action: 'pending',
    }
  }

  return {
    label: 'Vote',
    disabled: false,
    action: 'vote',
  }
}

function getCreatePollActionState({ walletAddress, transactionPhase, isWalletBusy }) {
  if (!walletAddress) {
    return {
      label: isWalletBusy ? 'Opening wallets...' : 'Connect wallet to create',
      disabled: isWalletBusy,
      action: 'connect',
    }
  }

  if (['preparing', 'awaiting-signature', 'pending'].includes(transactionPhase)) {
    return {
      label: 'Submitting...',
      disabled: true,
      action: 'pending',
    }
  }

  return {
    label: 'Create on-chain poll',
    disabled: false,
    action: 'create',
  }
}

function normalizeAddress(address) {
  return String(address || '').trim().toUpperCase()
}

function isPollOwner(poll, walletAddress) {
  return normalizeAddress(walletAddress) !== '' && normalizeAddress(walletAddress) === normalizeAddress(poll?.creator)
}

function getTransactionCopy(transaction) {
  switch (transaction?.phase) {
    case 'preparing':
      return 'Simulating the contract call and preparing the transaction.'
    case 'awaiting-signature':
      return 'Waiting for your wallet to review and sign the transaction.'
    case 'pending':
      return 'Submitted to Stellar testnet. Waiting for final confirmation.'
    case 'success':
      return 'Confirmed on-chain. Poll data is refreshing from contract events.'
    case 'error':
      return transaction.message
    default:
      return 'No transaction yet. Create a poll, vote, or close a poll to see on-chain status here.'
  }
}

function classifyError(error) {
  const rawMessage = error?.message || String(error || 'Unknown error')
  const message = rawMessage.toLowerCase()

  if (
    message.includes('not installed') ||
    message.includes('not available') ||
    message.includes('wallet not found') ||
    message.includes('missing wallet')
  ) {
    return {
      title: 'Wallet not found',
      message: 'Install Freighter, xBull, Albedo, or another supported Stellar wallet and try again.',
    }
  }

  if (
    message.includes('rejected') ||
    message.includes('declined') ||
    message.includes('denied') ||
    message.includes('closed before finishing') ||
    message.includes('cancelled')
  ) {
    return {
      title: 'Wallet request rejected',
      message: 'The wallet request was cancelled before it could sign the transaction.',
    }
  }

  if (
    message.includes('insufficient') ||
    message.includes('underfunded') ||
    message.includes('below reserve') ||
    message.includes('balance')
  ) {
    return {
      title: 'Insufficient balance',
      message: 'The connected wallet does not have enough testnet XLM to pay for the contract transaction.',
    }
  }

  if (message.includes('account not found')) {
    return {
      title: 'Testnet wallet not funded',
      message: 'This wallet address does not exist on Stellar testnet yet. Fund it with Friendbot before sending contract transactions.',
    }
  }

  if (message.includes('already voted')) {
    return {
      title: 'Vote already recorded',
      message: 'This wallet has already voted on the selected poll.',
    }
  }

  if (message.includes('pollinactive') || message.includes('poll inactive')) {
    return {
      title: 'Poll already closed',
      message: 'This poll is no longer accepting votes.',
    }
  }

  if (message.includes('pollexpired') || message.includes('expired')) {
    return {
      title: 'Poll expired',
      message: 'The selected poll already expired on-chain.',
    }
  }

  if (message.includes('missing vite_stellar_contract_id')) {
    return {
      title: 'Contract configuration missing',
      message: rawMessage,
    }
  }

  return {
    title: 'Something went wrong',
    message: rawMessage,
  }
}

function App() {
  const [wallet, setWallet] = useState(null)
  const [polls, setPolls] = useState(() => readCachedPolls())
  const [voteLookup, setVoteLookup] = useState({})
  const [selectedPollId, setSelectedPollId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('ending-soon')
  const [searchQuery, setSearchQuery] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [bootError, setBootError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [isBooting, setIsBooting] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isWalletBusy, setIsWalletBusy] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState(null)
  const [transaction, setTransaction] = useState({ phase: 'idle' })
  const [recentEvents, setRecentEvents] = useState([])

  const eventCursorRef = useRef(null)
  const refreshPollStateRef = useRef(null)
  const syncFromEventsRef = useRef(null)
  const dismissSelectedPollRef = useRef(null)
  const deferredSearch = useDeferredValue(searchQuery)

  const selectedPoll = useMemo(
    () => polls.find((poll) => poll.id === selectedPollId) || null,
    [polls, selectedPollId],
  )

  const createPollAction = useMemo(
    () =>
      getCreatePollActionState({
        walletAddress: wallet?.address,
        transactionPhase: transaction.phase,
        isWalletBusy,
      }),
    [isWalletBusy, transaction.phase, wallet?.address],
  )

  const visiblePolls = useMemo(() => {
    return polls
      .filter((poll) => {
        const state = getPollState(poll)
        if (filter === 'active' && state !== 'active') return false
        if (filter === 'closed' && state !== 'closed') return false

        const query = deferredSearch.trim().toLowerCase()
        if (!query) return true

        return (
          poll.question.toLowerCase().includes(query) ||
          poll.options.some((option) => option.toLowerCase().includes(query))
        )
      })
      .sort((left, right) => {
        if (sortBy === 'most-votes') {
          const leftVotes = left.votes.reduce((sum, vote) => sum + vote, 0)
          const rightVotes = right.votes.reduce((sum, vote) => sum + vote, 0)
          return rightVotes - leftVotes
        }
        if (sortBy === 'newest') return right.createdAt - left.createdAt
        if (sortBy === 'oldest') return left.createdAt - right.createdAt
        return left.expiresAt - right.expiresAt
      })
  }, [deferredSearch, filter, polls, sortBy])

  const stats = useMemo(() => {
    const activePolls = polls.filter((poll) => getPollState(poll) === 'active').length
    const totalVotes = polls.reduce(
      (sum, poll) => sum + poll.votes.reduce((voteSum, vote) => voteSum + vote, 0),
      0,
    )

    return { totalPolls: polls.length, activePolls, totalVotes }
  }, [polls])

  function showNotice(type, title, message) {
    setNotice({ type, title, message })
  }

  function clearPollHash() {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }

  function setPollHash(pollId) {
    window.history.replaceState(null, '', `#poll-${pollId}`)
  }

  function openPollDetails(pollId) {
    setSelectedPollId(pollId)
    setPollHash(pollId)
  }

  function dismissSelectedPoll() {
    setSelectedPollId(null)
    clearPollHash()
  }

  function handleFailure(error, txPhase = 'error') {
    const parsed = classifyError(error)
    setTransaction((current) => ({
      ...current,
      phase: txPhase,
      message: parsed.message,
    }))
    showNotice('error', parsed.title, parsed.message)
    return parsed
  }

  async function refreshPollState({ silent = false } = {}) {
    if (!CONTRACT_ID) {
      setBootError({
        title: 'Contract configuration missing',
        message: 'Add VITE_STELLAR_CONTRACT_ID to your environment variables so the app can sync on-chain state.',
      })
      setIsBooting(false)
      return
    }

    if (!silent) setIsRefreshing(true)

    try {
      const readAddress = await ensureReadAccount()
      const nextPolls = await fetchPolls(readAddress)
      const nextVotes = await fetchVoteStatuses(nextPolls, wallet?.address, readAddress)

      setPolls(nextPolls)
      setVoteLookup(nextVotes)

      window.setTimeout(() => {
        setLastSyncedAt(new window.Date().toISOString())
      }, 0)
      setBootError(null)

      const hashPollId = parsePollHash(window.location.hash)
      if (hashPollId && nextPolls.some((poll) => poll.id === hashPollId)) {
        setSelectedPollId(hashPollId)
      } else if (selectedPollId && !nextPolls.some((poll) => poll.id === selectedPollId)) {
        setSelectedPollId(null)
      }
    } catch (error) {
      const parsed = classifyError(error)
      setBootError(parsed)
      if (!silent) showNotice('error', parsed.title, parsed.message)
    } finally {
      setIsBooting(false)
      setIsRefreshing(false)
    }
  }

  async function syncFromEvents() {
    if (!CONTRACT_ID) return

    try {
      const eventBatch = await fetchContractEvents(eventCursorRef.current)
      eventCursorRef.current = eventBatch.cursor

      if (eventBatch.events.length > 0) {
        setRecentEvents((current) => mergeRecentEvents(current, eventBatch.events))
        await refreshPollState({ silent: true })
      }
    } catch {
      // Background event sync silent failure
    }
  }

  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    writeCachedPolls(polls)
  }, [polls])

  useEffect(() => {
    refreshPollStateRef.current = refreshPollState
    syncFromEventsRef.current = syncFromEvents
    dismissSelectedPollRef.current = dismissSelectedPoll
  })

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshPollStateRef.current?.()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [selectedPollId, wallet?.address])

  useEffect(() => {
    if (!CONTRACT_ID) return undefined
    const interval = window.setInterval(() => {
      syncFromEventsRef.current?.()
    }, 5000)
    return () => window.clearInterval(interval)
  }, [selectedPollId, wallet?.address])

  useEffect(() => {
    const syncSelectedPollFromHash = () => {
      const pollId = parsePollHash(window.location.hash)
      if (pollId) setSelectedPollId(pollId)
    }

    syncSelectedPollFromHash()
    window.addEventListener('hashchange', syncSelectedPollFromHash)
    return () => window.removeEventListener('hashchange', syncSelectedPollFromHash)
  }, [])

  useEffect(() => {
    if (!selectedPollId) {
      document.body.style.overflow = ''
      return undefined
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') dismissSelectedPollRef.current?.()
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedPollId])

  async function handleConnectWallet() {
    setIsWalletBusy(true)
    try {
      const connectedWallet = await connectWallet()
      setWallet(connectedWallet)
      showNotice(
        'success',
        'Wallet connected',
        `${connectedWallet.walletName} is ready to create polls and sign votes on Stellar Testnet.`,
      )
    } catch (error) {
      handleFailure(error)
    } finally {
      setIsWalletBusy(false)
    }
  }

  async function handleDisconnectWallet() {
    await disconnectWallet()
    setWallet(null)
    setVoteLookup({})
    showNotice('info', 'Wallet disconnected', 'Browsing in read-only mode.')
  }

  function updateTransactionStatus(update) {
    setTransaction((current) => ({ ...current, ...update }))
  }

  async function runContractWrite(method, args, successTitle, successMessage) {
    if (!wallet?.address) {
      showNotice('error', 'Wallet required', 'Connect a Stellar wallet before sending on-chain transactions.')
      return false
    }

    try {
      await submitContractTransaction({
        method,
        args,
        address: wallet.address,
        onStatus: updateTransactionStatus,
      })

      showNotice('success', successTitle, successMessage)
      await refreshPollState({ silent: true })
      return true
    } catch (error) {
      handleFailure(error)
      return false
    }
  }

  async function handleCreatePoll() {
    const walletAddress = wallet?.address
    const question = form.question.trim()
    const options = form.options.map((option) => option.trim()).filter(Boolean)

    if (!question) {
      setFormError('Please enter a question.')
      return
    }

    if (options.length < 2) {
      setFormError('Provide at least two answer options.')
      return
    }

    setFormError('')

    const created = await runContractWrite(
      'create_poll',
      {
        creator: walletAddress,
        question,
        options,
        duration_minutes: form.duration,
      },
      'Poll created',
      'Your poll was deployed on-chain and will refresh automatically.',
    )

    if (created) setForm(EMPTY_FORM)
  }

  async function handleVote(pollId, optionIndex) {
    await runContractWrite(
      'vote',
      {
        voter: wallet?.address,
        poll_id: pollId,
        option_index: optionIndex,
      },
      'Vote submitted',
      'Your vote was written to the contract.',
    )
  }

  async function handleClosePoll(pollId) {
    await runContractWrite(
      'close_poll',
      {
        poll_id: pollId,
        caller: wallet?.address,
      },
      'Poll closed',
      'The contract marked this poll as closed.',
    )
  }

  async function handleDeletePoll(pollId) {
    const deleted = await runContractWrite(
      'delete_poll',
      {
        poll_id: pollId,
        caller: wallet?.address,
      },
      'Poll deleted',
      'The contract removed this poll.',
    )

    if (deleted) {
      removeCachedPoll(pollId)
      setPolls((current) => current.filter((poll) => poll.id !== pollId))
      setVoteLookup((current) => {
        const next = { ...current }
        delete next[pollId]
        return next
      })

      if (selectedPollId === pollId) {
        setSelectedPollId(null)
        clearPollHash()
      }
    }
  }

  async function handleMenuDeletePoll(pollId) {
    if (!window.confirm(`Delete poll #${pollId}? This will remove it from the contract.`)) return
    await handleDeletePoll(pollId)
  }

  function addOption() {
    setForm((current) => ({
      ...current,
      options: current.options.length >= 6 ? current.options : [...current.options, ''],
    }))
  }

  function updateOption(index, value) {
    setForm((current) => ({
      ...current,
      options: current.options.map((option, optionIndex) =>
        optionIndex === index ? value : option,
      ),
    }))
  }

  function removeOption(index) {
    setForm((current) => ({
      ...current,
      options:
        current.options.length <= 2
          ? current.options
          : current.options.filter((_, optionIndex) => optionIndex !== index),
    }))
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-mark" aria-hidden="true">LP</div>
          <div>
            <h1>LivePoll</h1>
            <p>Soroban On-Chain Polls on Stellar Testnet</p>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="network-pill">
            <span className="status-dot" />
            {NETWORK_PASSPHRASE === 'Test SDF Network ; September 2015' ? 'Testnet' : 'Custom Network'}
          </div>

          {wallet ? (
            <button
              className="secondary-button wallet-disconnect-button"
              onClick={handleDisconnectWallet}
              type="button"
            >
              <span className="wallet-disconnect-copy">
                <span className="wallet-disconnect-status">Connected</span>
                <span className="wallet-disconnect-address">{shortenAddress(wallet.address)}</span>
              </span>
              <span className="wallet-disconnect-label">Disconnect</span>
            </button>
          ) : (
            <button className="primary-button" onClick={handleConnectWallet} disabled={isWalletBusy}>
              {isWalletBusy ? 'Opening Wallets...' : 'Connect Wallet'}
            </button>
          )}
        </div>
      </header>

      {notice && (
        <section className={`notice ${notice.type}`}>
          <strong>{notice.title}</strong>
          <span>{notice.message}</span>
        </section>
      )}

      {bootError && (
        <section className="notice error">
          <strong>{bootError.title}</strong>
          <span>{bootError.message}</span>
        </section>
      )}

      <main className="dashboard">
        <section className="hero-grid">
          <article className="panel hero-card">
            <div>
              <p className="section-label">Supported Wallets</p>
              <h2>Stellar Wallets Integration</h2>
              <p>
                Connect with {SUPPORTED_WALLET_NAMES.length}+ wallets via StellarWalletsKit to sign transactions.
              </p>
            </div>

            <div className="wallet-grid">
              {SUPPORTED_WALLET_NAMES.map((walletName) => (
                <div key={walletName} className="wallet-chip">
                  {walletName}
                </div>
              ))}
            </div>
          </article>

          <article className="panel status-card">
            <div className="status-card-top">
              <p className="section-label">Transaction Status</p>
              <span className={`phase-badge ${transaction.phase}`}>{transaction.phase}</span>
            </div>
            <p className="status-message">{getTransactionCopy(transaction)}</p>

            {transaction.hash && (
              <a
                className="inline-link"
                href={getExplorerLink('tx', transaction.hash)}
                target="_blank"
                rel="noreferrer"
              >
                View on StellarExpert
              </a>
            )}

            <dl className="status-list">
              <div>
                <dt>RPC</dt>
                <dd>{RPC_URL}</dd>
              </div>
              <div>
                <dt>Contract ID</dt>
                <dd>{CONTRACT_ID ? `${CONTRACT_ID.slice(0, 8)}...` : 'Not Set'}</dd>
              </div>
              <div>
                <dt>Last Sync</dt>
                <dd>{formatDateTime(lastSyncedAt)}</dd>
              </div>
            </dl>
          </article>
        </section>

        <section className="stats-grid">
          <StatCard label="Total Polls" value={stats.totalPolls} />
          <StatCard label="Active Polls" value={stats.activePolls} />
          <StatCard label="Total Votes" value={stats.totalVotes} />
        </section>

        <section className="workspace-grid">
          {/* Create Poll Panel */}
          <article className="panel compose-panel">
            <div className="panel-head">
              <div>
                <p className="section-label">New Poll</p>
                <h3>Create On-Chain Poll</h3>
              </div>
            </div>

            <label className="field">
              <span>Question</span>
              <textarea
                value={form.question}
                onChange={(event) => setForm((current) => ({ ...current, question: event.target.value }))}
                placeholder="What is your question?"
                rows={3}
              />
            </label>

            <div className="field">
              <span>Options</span>
              <div className="option-stack">
                {form.options.map((option, index) => (
                  <div key={index} className="option-row">
                    <input
                      value={option}
                      onChange={(event) => updateOption(index, event.target.value)}
                      placeholder={`Option ${index + 1}`}
                    />
                    {form.options.length > 2 && (
                      <button className="icon-button" onClick={() => removeOption(index)} type="button">
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {form.options.length < 6 && (
                <button className="ghost-button" onClick={addOption} type="button">
                  + Add Option
                </button>
              )}
            </div>

            <div className="field">
              <span>Duration</span>
              <div className="duration-row">
                {DURATION_PRESETS.map((minutes) => (
                  <button
                    key={minutes}
                    className={minutes === form.duration ? 'duration-pill active' : 'duration-pill'}
                    onClick={() => setForm((current) => ({ ...current, duration: minutes }))}
                    type="button"
                  >
                    {minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}
                  </button>
                ))}
              </div>
            </div>

            {formError && <p className="form-error">{formError}</p>}

            <div className="panel-actions">
              <button className="secondary-button" onClick={() => setForm(EMPTY_FORM)} type="button">
                Reset
              </button>
              <button
                className="primary-button"
                onClick={() =>
                  createPollAction.action === 'connect' ? handleConnectWallet() : handleCreatePoll()
                }
                disabled={createPollAction.disabled}
                type="button"
              >
                {createPollAction.label}
              </button>
            </div>
          </article>

          {/* Sync & Events Feed Panel */}
          <article className="panel sync-panel">
            <div className="panel-head">
              <div>
                <p className="section-label">Real-Time Sync</p>
                <h3>On-Chain Activity</h3>
              </div>
              <button className="secondary-button" onClick={() => refreshPollState()} type="button">
                {isRefreshing || isBooting ? 'Syncing...' : 'Refresh'}
              </button>
            </div>

            <div className="event-feed">
              {recentEvents.length === 0 ? (
                <p className="event-empty">Listening for contract events...</p>
              ) : (
                <div className="event-list">
                  {recentEvents.map((event) => (
                    <article key={event.id} className="event-card">
                      <div className="event-card-head">
                        <div>
                          <strong>{event.title}</strong>
                          <p>{event.summary}</p>
                        </div>
                        <span className={`state-pill ${event.action}`}>{event.action}</span>
                      </div>
                      <div className="event-meta">
                        <span>Ledger {event.ledger}</span>
                        <span>{formatEventTime(event.ledgerClosedAt)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </article>
        </section>

        {/* Poll List Feed */}
        <section className="panel poll-panel">
          <div className="controls-head">
            <div>
              <p className="section-label">Live Feed</p>
              <h3>Active &amp; Closed Polls</h3>
            </div>

            <div className="control-strip">
              <input
                className="search-input"
                placeholder="Search polls..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />

              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>

              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="ending-soon">Ending Soon</option>
                <option value="most-votes">Most Votes</option>
                <option value="newest">Newest</option>
              </select>
            </div>
          </div>

          {isBooting ? (
            <div className="empty-state">
              <h4>Loading contract state...</h4>
            </div>
          ) : visiblePolls.length === 0 ? (
            <div className="empty-state">
              <h4>No polls found</h4>
            </div>
          ) : (
            <div className="poll-grid">
              {visiblePolls.map((poll) => {
                const totalVotes = poll.votes.reduce((sum, vote) => sum + vote, 0)
                const state = getPollState(poll)
                const hasVoted = Boolean(voteLookup[poll.id])
                const voteAction = getVoteActionState({
                  poll,
                  walletAddress: wallet?.address,
                  hasVoted,
                  transactionPhase: transaction.phase,
                  isWalletBusy,
                })
                const isOwner = isPollOwner(poll, wallet?.address)

                return (
                  <article key={poll.id} className="poll-card">
                    <div className="poll-card-head">
                      <span className={`state-pill ${state}`}>{state}</span>
                      <span className="time-pill">{formatTimeLeft(poll.expiresAt)}</span>
                    </div>

                    <h4>{poll.question}</h4>
                    <p className="poll-meta">
                      <span>by {shortenAddress(poll.creator)}</span> · <span>{totalVotes} votes</span>
                    </p>

                    <div className="poll-options">
                      {poll.options.map((option, index) => {
                        const votes = poll.votes[index] || 0
                        const percentage = totalVotes === 0 ? 0 : Math.round((votes / totalVotes) * 100)
                        const canVote = voteAction.action === 'vote' || voteAction.action === 'connect'

                        return (
                          <div key={index} className="poll-option">
                            <button
                              className={`poll-option-btn${hasVoted || state === 'closed' ? ' voted' : ''}`}
                              onClick={() =>
                                voteAction.action === 'connect'
                                  ? handleConnectWallet()
                                  : canVote
                                  ? handleVote(poll.id, index)
                                  : undefined
                              }
                              disabled={voteAction.disabled && voteAction.action !== 'connect'}
                              type="button"
                            >
                              <span className="poll-option-label">{option}</span>
                              <span className="poll-option-meta">{votes} ({percentage}%)</span>
                            </button>
                            <div className="poll-option-bar">
                              <div className="poll-option-bar-fill" style={{ width: `${percentage}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div className="poll-card-footer">
                      <button
                        className="ghost-button small"
                        onClick={() => openPollDetails(poll.id)}
                        type="button"
                      >
                        Details
                      </button>

                      {isOwner && state === 'active' && (
                        <div className="owner-actions">
                          <button
                            className="ghost-button small"
                            onClick={() => handleClosePoll(poll.id)}
                            type="button"
                          >
                            Close
                          </button>
                          <button
                            className="ghost-button small danger"
                            onClick={() => handleMenuDeletePoll(poll.id)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <article className="panel stat-card">
      <p className="section-label">{label}</p>
      <strong>{value}</strong>
    </article>
  )
}

export default App
