'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { callAIAgent } from '@/lib/aiAgent'
import { uploadAndTrainDocument } from '@/lib/ragKnowledgeBase'
import { Switch } from '@/components/ui/switch'
import { IoWater, IoSend, IoCloudUpload, IoClose, IoRefresh, IoChevronDown, IoChevronUp, IoDocumentText } from 'react-icons/io5'
import { MdPayment, MdPlayArrow } from 'react-icons/md'
import { FiAlertTriangle, FiDroplet, FiLoader } from 'react-icons/fi'
import { BiSupport, BiReceipt } from 'react-icons/bi'
import { HiOutlineChatAlt2, HiOutlinePlus } from 'react-icons/hi'
import { RiWaterFlashLine } from 'react-icons/ri'

const AGENT_ID = '6992cdd08c5dd1e7b9200d14'
const RAG_ID = '6992cda7869797813b09585e'

// -- Types --

interface ChatMessage {
  id: string
  role: 'user' | 'agent' | 'error'
  content: string
  timestamp: number
  intentCategory?: string
  escalated?: boolean
  resolutionStatus?: string
}

interface QuickAction {
  label: string
  icon: React.ReactNode
  message: string
}

// -- Helpers --

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

function extractAgentMessage(result: any): string {
  const agentResult = result?.response?.result
  if (agentResult) {
    if (typeof agentResult.response === 'string') return agentResult.response
    if (typeof agentResult.text === 'string') return agentResult.text
    if (typeof agentResult.message === 'string') return agentResult.message
    if (typeof agentResult.answer === 'string') return agentResult.answer
    if (typeof agentResult.content === 'string') return agentResult.content
  }
  if (typeof result?.response?.message === 'string') return result.response.message
  if (typeof result?.response?.result === 'string') return result.response.result
  return 'I apologize, but I was unable to process your request. Please try again.'
}

function extractIntentCategory(result: any): string {
  return result?.response?.result?.intent_category || 'general'
}

function extractEscalated(result: any): boolean {
  return result?.response?.result?.escalated === true
}

function extractResolutionStatus(result: any): string {
  return result?.response?.result?.resolution_status || 'diagnosing'
}

function getRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

function getIntentLabel(intent: string): string {
  const labels: Record<string, string> = {
    outage: 'Outage',
    water_quality: 'Water Quality',
    leak: 'Leak Report',
    billing: 'Billing',
    payment: 'Payment',
    service: 'Service',
    general: 'General',
  }
  return labels[intent] || intent
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'resolved': return 'bg-green-100 text-green-800 border-green-200'
    case 'escalated': return 'bg-amber-100 text-amber-800 border-amber-200'
    case 'pending_info': return 'bg-blue-100 text-blue-800 border-blue-200'
    case 'diagnosing': return 'bg-muted text-muted-foreground border-border'
    default: return 'bg-muted text-muted-foreground border-border'
  }
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    diagnosing: 'Diagnosing',
    resolved: 'Resolved',
    escalated: 'Escalated',
    pending_info: 'Pending Info',
  }
  return labels[status] || status
}

// -- Markdown Renderer --

function formatInline(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold">{part}</strong>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  )
}

function renderMarkdown(text: string) {
  if (!text) return null
  return (
    <div className="space-y-1.5">
      {text.split('\n').map((line, i) => {
        if (line.startsWith('### '))
          return <h4 key={i} className="font-semibold text-sm mt-3 mb-1">{line.slice(4)}</h4>
        if (line.startsWith('## '))
          return <h3 key={i} className="font-semibold text-base mt-3 mb-1">{line.slice(3)}</h3>
        if (line.startsWith('# '))
          return <h2 key={i} className="font-bold text-lg mt-4 mb-2">{line.slice(2)}</h2>
        if (line.startsWith('- ') || line.startsWith('* '))
          return <li key={i} className="ml-4 list-disc text-sm">{formatInline(line.slice(2))}</li>
        if (/^\d+\.\s/.test(line))
          return <li key={i} className="ml-4 list-decimal text-sm">{formatInline(line.replace(/^\d+\.\s/, ''))}</li>
        if (!line.trim()) return <div key={i} className="h-1" />
        return <p key={i} className="text-sm leading-relaxed">{formatInline(line)}</p>
      })}
    </div>
  )
}

// -- Quick Actions Data --

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'No Water', icon: <RiWaterFlashLine className="w-5 h-5" />, message: 'I have no water at my property. Can you help?' },
  { label: 'Water Quality', icon: <FiDroplet className="w-5 h-5" />, message: 'I have concerns about my water quality. The water looks discolored.' },
  { label: 'Report a Leak', icon: <FiAlertTriangle className="w-5 h-5" />, message: 'I need to report a water leak near my property.' },
  { label: 'Billing Question', icon: <BiReceipt className="w-5 h-5" />, message: 'I have a question about my recent water bill.' },
  { label: 'Payment Status', icon: <MdPayment className="w-5 h-5" />, message: 'I would like to check the status of my recent payment.' },
  { label: 'Start/Stop Service', icon: <MdPlayArrow className="w-5 h-5" />, message: 'I need to start or stop my water service.' },
]

// -- Sample Data --

const SAMPLE_MESSAGES: ChatMessage[] = [
  {
    id: 's1',
    role: 'user',
    content: 'I have a question about my recent water bill. It seems higher than usual.',
    timestamp: Date.now() - 300000,
  },
  {
    id: 's2',
    role: 'agent',
    content: "I understand your concern about the higher bill. Let me help you look into this.\n\nThere are a few common reasons for an increase in your water bill:\n\n- **Seasonal changes** in water usage (e.g., lawn irrigation)\n- **A leak** in your plumbing system\n- **Meter reading adjustments** from estimated to actual readings\n\nCould you please provide your **account number** so I can pull up your billing history and compare recent usage patterns?",
    timestamp: Date.now() - 240000,
    intentCategory: 'billing',
    escalated: false,
    resolutionStatus: 'diagnosing',
  },
  {
    id: 's3',
    role: 'user',
    content: 'My account number is 4829371. I noticed the bill is about 40% higher than last month.',
    timestamp: Date.now() - 180000,
  },
  {
    id: 's4',
    role: 'agent',
    content: "Thank you for providing your account number. I've reviewed your billing history and here's what I found:\n\n### Usage Analysis\n- **Current month:** 12,400 gallons\n- **Previous month:** 8,800 gallons\n- **Increase:** ~41%\n\nThis increase appears to be outside your normal usage pattern. I recommend:\n\n1. **Check for leaks** - Turn off all water fixtures and check your meter. If it's still running, you may have a leak.\n2. **Review recent usage** - Any new appliances, guests, or outdoor watering?\n3. **Request a meter test** - If you suspect the meter is faulty, we can schedule a free test.\n\nWould you like me to schedule a meter test or help with anything else?",
    timestamp: Date.now() - 120000,
    intentCategory: 'billing',
    escalated: false,
    resolutionStatus: 'pending_info',
  },
]

// -- Typing Indicator Component --

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 px-4 md:px-6 py-2">
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
        <IoWater className="w-4 h-4 text-primary" />
      </div>
      <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}

// -- Message Bubble Component --

function MessageBubble({ message, onRetry }: { message: ChatMessage; onRetry?: () => void }) {
  const [timeDisplay, setTimeDisplay] = useState('')

  useEffect(() => {
    setTimeDisplay(getRelativeTime(message.timestamp))
    const interval = setInterval(() => {
      setTimeDisplay(getRelativeTime(message.timestamp))
    }, 30000)
    return () => clearInterval(interval)
  }, [message.timestamp])

  if (message.role === 'user') {
    return (
      <div className="flex justify-end px-4 md:px-6 py-1.5">
        <div className="max-w-[85%] md:max-w-[70%]">
          <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-3 shadow-md">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 text-right pr-1">{timeDisplay}</p>
        </div>
      </div>
    )
  }

  if (message.role === 'error') {
    return (
      <div className="flex items-start gap-3 px-4 md:px-6 py-1.5">
        <div className="w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
          <FiAlertTriangle className="w-4 h-4 text-destructive" />
        </div>
        <div className="max-w-[85%] md:max-w-[70%]">
          <div className="bg-destructive/5 border border-destructive/20 rounded-2xl rounded-tl-md px-4 py-3">
            <p className="text-sm text-destructive">{message.content}</p>
            {onRetry && (
              <button onClick={onRetry} className="mt-2 flex items-center gap-1.5 text-xs text-destructive hover:text-destructive/80 font-medium transition-colors">
                <IoRefresh className="w-3.5 h-3.5" />
                Retry
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 pl-1">{timeDisplay}</p>
        </div>
      </div>
    )
  }

  // Agent message
  return (
    <div className="flex items-start gap-3 px-4 md:px-6 py-1.5">
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <IoWater className="w-4 h-4 text-primary" />
      </div>
      <div className="max-w-[85%] md:max-w-[70%]">
        <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
          {renderMarkdown(message.content)}
          {(message.intentCategory || message.resolutionStatus || message.escalated) && (
            <div className="flex flex-wrap gap-1.5 mt-3 pt-2 border-t border-border/30">
              {message.intentCategory && message.intentCategory !== 'general' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium">
                  {getIntentLabel(message.intentCategory)}
                </span>
              )}
              {message.resolutionStatus && (
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border ${getStatusColor(message.resolutionStatus)}`}>
                  {getStatusLabel(message.resolutionStatus)}
                </span>
              )}
              {message.escalated && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 text-[11px] font-medium">
                  <FiAlertTriangle className="w-3 h-3" />
                  Escalated
                </span>
              )}
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1 pl-1">{timeDisplay}</p>
      </div>
    </div>
  )
}

// -- Welcome Card Component --

function WelcomeCard({ onQuickAction }: { onQuickAction: (msg: string) => void }) {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-8">
      <div className="max-w-lg w-full text-center">
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-primary/10 flex items-center justify-center">
          <IoWater className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">How can we help you today?</h2>
        <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto leading-relaxed">
          Get instant support for water service issues, billing questions, leak reports, and more. Our AI assistant is here to help 24/7.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => onQuickAction(action.message)}
              className="flex flex-col items-center gap-2 px-4 py-4 rounded-[0.875rem] bg-card/80 backdrop-blur-sm border border-border/50 hover:border-primary/30 hover:bg-primary/5 transition-all duration-200 shadow-sm hover:shadow-md group"
            >
              <span className="text-primary group-hover:scale-110 transition-transform duration-200">{action.icon}</span>
              <span className="text-xs font-medium text-foreground">{action.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// -- Upload Panel Component --

function UploadPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<{ success: boolean; message: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadStatus(null)

    try {
      const result = await uploadAndTrainDocument(RAG_ID, file)
      if (result.success) {
        setUploadStatus({ success: true, message: `"${file.name}" uploaded and trained successfully.` })
      } else {
        setUploadStatus({ success: false, message: result.error || 'Upload failed. Please try again.' })
      }
    } catch {
      setUploadStatus({ success: false, message: 'An unexpected error occurred during upload.' })
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  if (!isOpen) return null

  return (
    <div className="absolute top-full right-0 mt-2 w-80 bg-card/95 backdrop-blur-xl border border-border/60 rounded-[0.875rem] shadow-xl z-50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">Knowledge Base</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <IoClose className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">Upload documents (PDF, DOCX, TXT) to enhance the support knowledge base.</p>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.txt"
        onChange={handleFileUpload}
        className="hidden"
        id="kb-upload"
      />
      <label
        htmlFor="kb-upload"
        className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-[0.875rem] border-2 border-dashed cursor-pointer transition-all duration-200 text-sm font-medium ${uploading ? 'border-primary/30 bg-primary/5 text-primary/60 cursor-wait' : 'border-border hover:border-primary/40 hover:bg-primary/5 text-muted-foreground hover:text-primary'}`}
      >
        {uploading ? (
          <>
            <FiLoader className="w-4 h-4 animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <IoCloudUpload className="w-4 h-4" />
            Choose File
          </>
        )}
      </label>
      {uploadStatus && (
        <div className={`mt-3 p-2.5 rounded-lg text-xs ${uploadStatus.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {uploadStatus.message}
        </div>
      )}
    </div>
  )
}

// -- Agent Info Section --

function AgentInfoBar({ isActive }: { isActive: boolean }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-t border-border/40 bg-card/40 backdrop-blur-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-2">
          <BiSupport className="w-3.5 h-3.5" />
          Powered by AI Agent
          {isActive && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-green-600">Active</span>
            </span>
          )}
        </span>
        {expanded ? <IoChevronDown className="w-3.5 h-3.5" /> : <IoChevronUp className="w-3.5 h-3.5" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 pt-1">
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background/60 border border-border/40">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <HiOutlineChatAlt2 className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">Veolia Customer Support Agent</p>
              <p className="text-[11px] text-muted-foreground">Outages, billing, water quality, leaks, payments, service requests</p>
            </div>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Main Page Component
// ============================================================

export default function Page() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showSampleData, setShowSampleData] = useState(false)
  const [showUploadPanel, setShowUploadPanel] = useState(false)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null)

  const userIdRef = useRef<string>(generateId())
  const sessionIdRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  const displayMessages = showSampleData && messages.length === 0 ? SAMPLE_MESSAGES : messages

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [displayMessages, isLoading, scrollToBottom])

  // Auto-focus input
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [])

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value)
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
  }

  // Send message
  const sendMessage = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return

    setLastFailedMessage(null)

    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    setIsLoading(true)
    setActiveAgentId(AGENT_ID)

    try {
      const result = await callAIAgent(trimmed, AGENT_ID, {
        user_id: userIdRef.current,
        session_id: sessionIdRef.current ?? undefined,
      })

      if (result.success) {
        // Store session_id for subsequent calls
        if (result.session_id) {
          sessionIdRef.current = result.session_id
        }

        const agentText = extractAgentMessage(result)
        const intentCategory = extractIntentCategory(result)
        const escalated = extractEscalated(result)
        const resolutionStatus = extractResolutionStatus(result)

        const agentMessage: ChatMessage = {
          id: generateId(),
          role: 'agent',
          content: agentText,
          timestamp: Date.now(),
          intentCategory,
          escalated,
          resolutionStatus,
        }

        setMessages(prev => [...prev, agentMessage])
      } else {
        setLastFailedMessage(trimmed)
        const errorMessage: ChatMessage = {
          id: generateId(),
          role: 'error',
          content: result.error || 'Failed to get a response. Please try again.',
          timestamp: Date.now(),
        }
        setMessages(prev => [...prev, errorMessage])
      }
    } catch {
      setLastFailedMessage(trimmed)
      const errorMessage: ChatMessage = {
        id: generateId(),
        role: 'error',
        content: 'A network error occurred. Please check your connection and try again.',
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
      setActiveAgentId(null)
    }
  }

  const handleRetry = () => {
    if (lastFailedMessage) {
      // Remove the last error message
      setMessages(prev => {
        const lastIdx = prev.length - 1
        if (lastIdx >= 0 && prev[lastIdx].role === 'error') {
          return prev.slice(0, lastIdx)
        }
        return prev
      })
      sendMessage(lastFailedMessage)
    }
  }

  const handleNewConversation = () => {
    setMessages([])
    setInputValue('')
    sessionIdRef.current = null
    userIdRef.current = generateId()
    setLastFailedMessage(null)
    setShowSampleData(false)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(inputValue)
    }
  }

  const handleQuickAction = (message: string) => {
    sendMessage(message)
  }

  return (
    <div className="h-screen flex flex-col" style={{ background: 'linear-gradient(135deg, hsl(120 25% 96%) 0%, hsl(140 30% 94%) 35%, hsl(160 25% 95%) 70%, hsl(100 20% 96%) 100%)' }}>
      {/* Header */}
      <header className="flex-shrink-0 relative z-30" style={{ backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
        <div className="bg-card/75 border-b border-border/50 shadow-sm">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <IoWater className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-base font-bold text-foreground leading-tight">Water Services Support</h1>
                <p className="text-[11px] text-muted-foreground">Veolia Customer Care</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Sample Data Toggle */}
              <div className="flex items-center gap-2 mr-2">
                <span className="text-[11px] text-muted-foreground font-medium">Sample Data</span>
                <Switch
                  checked={showSampleData}
                  onCheckedChange={setShowSampleData}
                />
              </div>
              {/* KB Upload Button */}
              <div className="relative">
                <button
                  onClick={() => setShowUploadPanel(!showUploadPanel)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center bg-secondary/60 hover:bg-secondary border border-border/40 text-muted-foreground hover:text-foreground transition-all duration-200"
                  title="Knowledge Base"
                >
                  <IoDocumentText className="w-4 h-4" />
                </button>
                <UploadPanel isOpen={showUploadPanel} onClose={() => setShowUploadPanel(false)} />
              </div>
              {/* New Conversation */}
              <button
                onClick={handleNewConversation}
                className="w-9 h-9 rounded-xl flex items-center justify-center bg-secondary/60 hover:bg-secondary border border-border/40 text-muted-foreground hover:text-foreground transition-all duration-200"
                title="New Conversation"
              >
                <HiOutlinePlus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <div className="flex-1 overflow-hidden flex flex-col max-w-4xl w-full mx-auto">
        <div className="flex-1 overflow-y-auto" ref={chatScrollRef}>
          {displayMessages.length === 0 && !showSampleData ? (
            <WelcomeCard onQuickAction={handleQuickAction} />
          ) : (
            <div className="py-4 space-y-1">
              {displayMessages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onRetry={msg.role === 'error' ? handleRetry : undefined}
                />
              ))}
              {isLoading && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="flex-shrink-0 px-4 pb-3 pt-2">
          <div className="bg-card/80 backdrop-blur-xl border border-border/50 rounded-2xl shadow-lg p-2 flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Describe your issue..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none px-3 py-2.5 max-h-[120px] leading-relaxed"
              disabled={isLoading}
            />
            <button
              onClick={() => sendMessage(inputValue)}
              disabled={!inputValue.trim() || isLoading}
              className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-all duration-200 shadow-sm"
            >
              {isLoading ? (
                <FiLoader className="w-4 h-4 animate-spin" />
              ) : (
                <IoSend className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Agent Info */}
      <AgentInfoBar isActive={activeAgentId !== null} />
    </div>
  )
}
