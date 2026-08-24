import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { generateColdEmailApi, sendColdEmailApi } from '../services/job.api';
import '../styles/jobs.scss';

const Jobs = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const [jobs, setJobs] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedJob, setSelectedJob] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);

    // Cold Email Form state
    const [recipientName, setRecipientName] = useState('Founder / Hiring Lead');
    const [recipientRole, setRecipientRole] = useState('Founder & CEO');
    const [toEmail, setToEmail] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [generatingEmail, setGeneratingEmail] = useState(false);
    const [sendingEmail, setSendingEmail] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');
    const [previewUrl, setPreviewUrl] = useState('');

    useEffect(() => {
        // Load jobs from route state or sessionStorage
        if (location.state?.jobs) {
            setJobs(location.state.jobs);
            setSearchQuery(location.state.searchQuery || 'Software Role');
            sessionStorage.setItem('careerlens_jobs', JSON.stringify(location.state.jobs));
            sessionStorage.setItem('careerlens_query', location.state.searchQuery || '');
        } else {
            const savedJobs = sessionStorage.getItem('careerlens_jobs');
            const savedQuery = sessionStorage.getItem('careerlens_query');
            if (savedJobs) {
                setJobs(JSON.parse(savedJobs));
                setSearchQuery(savedQuery || 'Software Role');
            }
        }
    }, [location.state]);

    const openColdEmailModal = (job) => {
        setSelectedJob(job);
        setRecipientName('Founder / Hiring Manager');
        setRecipientRole('Founder & CEO');
        setToEmail('');
        setSubject(`Application for ${job.title} position`);
        setBody(`Hi [Founder Name],\n\nI am writing to express my interest in the ${job.title} role at ${job.company}.\n\nBest regards,\n[Your Name]`);
        setStatusMsg('');
        setModalOpen(true);
    };

    const handleGenerateColdEmail = async () => {
        if (!selectedJob) return;
        setGeneratingEmail(true);
        setStatusMsg('');
        try {
            const res = await generateColdEmailApi({
                recipientName,
                recipientRole,
                jobTitle: selectedJob.title,
                jobDescription: selectedJob.jobDescription || selectedJob.summary,
                companyName: selectedJob.company
            });

            if (res && res.subject && res.body) {
                setSubject(res.subject);
                setBody(res.body);
            }
        } catch (err) {
            console.error('Error generating cold email:', err);
            setStatusMsg('Failed to generate email. Please try again.');
        } finally {
            setGeneratingEmail(false);
        }
    };

    const handleSendViaClient = () => {
        if (!subject || !body) return;
        const mailtoUrl = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(mailtoUrl, '_blank');
    };

    const handleDirectSend = async () => {
        if (!toEmail || !toEmail.trim()) {
            alert('Please enter a recipient email address.');
            return;
        }
        setSendingEmail(true);
        setStatusMsg('');
        setPreviewUrl('');
        try {
            const res = await sendColdEmailApi({
                toEmail,
                subject,
                body
            });
            setStatusMsg(res.message || 'Email dispatched successfully!');
            if (res.previewUrl) {
                setPreviewUrl(res.previewUrl);
            }
        } catch (err) {
            console.error('Error sending email:', err);
            setStatusMsg(err.response?.data?.message || 'Failed to send email.');
        } finally {
            setSendingEmail(false);
        }
    };

    const handleCopyEmail = () => {
        const fullText = `Subject: ${subject}\n\n${body}`;
        navigator.clipboard.writeText(fullText);
        alert('Cold email text copied to clipboard!');
    };

    const getValidApplyUrl = (job) => {
        let url = String(job.link || '').trim();

        if (url.startsWith('/')) {
            if (job.platform === 'LinkedIn') url = `https://www.linkedin.com${url}`;
            else if (job.platform === 'Wellfound') url = `https://wellfound.com${url}`;
            else url = `https://www.naukri.com${url}`;
        }

        if (!url || url === '#' || url.includes('localhost') || url === 'https://www.naukri.com' || url === 'https://www.linkedin.com/jobs' || url === 'https://wellfound.com') {
            const queryTerm = encodeURIComponent(`${job.title || ''} ${job.company || ''}`.trim() || searchQuery || 'software engineer');
            if (job.platform === 'LinkedIn') {
                url = `https://www.linkedin.com/jobs/search/?keywords=${queryTerm}`;
            } else if (job.platform === 'Wellfound') {
                url = `https://wellfound.com/jobs?q=${queryTerm}`;
            } else {
                const formattedQuery = job.title ? job.title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-') : 'software-engineer';
                url = `https://www.naukri.com/${formattedQuery}-jobs`;
            }
        }

        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = `https://${url}`;
        }

        return url;
    };

    return (
        <div className="jobs-page">
            {/* Header */}
            <header className="jobs-header">
                <span className="back-link" onClick={() => navigate('/')}>
                    &larr; Back to Dashboard
                </span>
                <h1>Matched Job Opportunities</h1>
                <p>
                    Curated & scraped multi-platform jobs tailored for <span className="query-badge">{searchQuery}</span>
                </p>
            </header>

            {/* Jobs Grid */}
            {jobs.length === 0 ? (
                <div className="jobs-header">
                    <p>No job matches found yet. Please go back to the home page, upload a resume or self-description, and click <strong>Find Me Jobs</strong>.</p>
                </div>
            ) : (
                <div className="jobs-grid">
                    {jobs.map((job, idx) => {
                        const platformClass =
                            job.platform === 'Naukri.com' ? 'platform-badge--naukri' :
                            job.platform === 'LinkedIn' ? 'platform-badge--linkedin' :
                            job.platform === 'Wellfound' ? 'platform-badge--wellfound' : 'platform-badge--direct';

                        const scoreColor =
                            job.matchScore >= 80 ? 'score--high' :
                            job.matchScore >= 60 ? 'score--mid' : 'score--low';

                        return (
                            <div key={job.id || idx} className="job-card">
                                <div className="job-card__header">
                                    <div className="job-card__title-group">
                                        <span className={`platform-badge ${platformClass}`}>{job.platform}</span>
                                        <h2>{job.title}</h2>
                                        <div className="company-info">
                                            <span>🏢 {job.company}</span>
                                            <span>📍 {job.location}</span>
                                            <span>⏳ {job.exp}</span>
                                            {job.salaryRange && <span>💰 {job.salaryRange}</span>}
                                        </div>
                                    </div>
                                    <div className="job-card__score">
                                        <div className={`score-pill ${scoreColor}`}>{job.matchScore}%</div>
                                        <span className="label">Match Score</span>
                                    </div>
                                </div>

                                <div className="job-card__summary">
                                    <strong>Why you match: </strong>{job.summary}
                                </div>

                                {job.keyRequirements && job.keyRequirements.length > 0 && (
                                    <div className="job-card__skills">
                                        {job.keyRequirements.map((skill, sIdx) => (
                                            <span key={sIdx} className="skill-tag">{skill}</span>
                                        ))}
                                    </div>
                                )}

                                <div className="job-card__actions">
                                    <a
                                        href={getValidApplyUrl(job)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="apply-link"
                                    >
                                        🔗 View Original Post & Apply
                                    </a>
                                    <button
                                        onClick={() => openColdEmailModal(job)}
                                        className="cold-email-btn"
                                    >
                                        ✉️ Cold Email Founder
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Cold Email Modal */}
            {modalOpen && selectedJob && (
                <div className="modal-overlay" onClick={() => setModalOpen(false)}>
                    <div className="email-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="email-modal__header">
                            <h2>Cold Email &bull; {selectedJob.company}</h2>
                            <button className="close-btn" onClick={() => setModalOpen(false)}>&times;</button>
                        </div>

                        <div className="email-modal__body">
                            {statusMsg && (
                                <div style={{ color: '#4ade80', fontSize: '0.85rem' }}>
                                    {statusMsg}
                                    {previewUrl && (
                                        <div style={{ marginTop: '0.25rem' }}>
                                            🔗 <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>
                                                Click here to preview live sent email on Ethereal
                                            </a>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="row-inputs">
                                <div className="input-group">
                                    <label>Recipient Name (Founder / Owner)</label>
                                    <input
                                        type="text"
                                        value={recipientName}
                                        onChange={(e) => setRecipientName(e.target.value)}
                                        placeholder="e.g. Sarah Jenkins"
                                    />
                                </div>
                                <div className="input-group">
                                    <label>Recipient Role / Title</label>
                                    <input
                                        type="text"
                                        value={recipientRole}
                                        onChange={(e) => setRecipientRole(e.target.value)}
                                        placeholder="e.g. Founder & CEO"
                                    />
                                </div>
                            </div>

                            <button
                                onClick={handleGenerateColdEmail}
                                disabled={generatingEmail}
                                className="generate-action-btn"
                            >
                                {generatingEmail ? 'Generating AI Email...' : '✨ Generate AI Cold Email'}
                            </button>

                            <div className="input-group">
                                <label>Recipient Email Address</label>
                                <input
                                    type="email"
                                    value={toEmail}
                                    onChange={(e) => setToEmail(e.target.value)}
                                    placeholder="founder@company.com"
                                />
                            </div>

                            <div className="input-group">
                                <label>Email Subject (Editable)</label>
                                <input
                                    type="text"
                                    value={subject}
                                    onChange={(e) => setSubject(e.target.value)}
                                />
                            </div>

                            <div className="input-group">
                                <label>Email Content (Editable)</label>
                                <textarea
                                    value={body}
                                    onChange={(e) => setBody(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="email-modal__footer">
                            <button className="btn-secondary" onClick={handleCopyEmail}>
                                📋 Copy Text
                            </button>
                            <button className="btn-secondary" onClick={handleSendViaClient}>
                                🚀 Open in Email Client
                            </button>
                            <button
                                className="btn-primary"
                                onClick={handleDirectSend}
                                disabled={sendingEmail}
                            >
                                {sendingEmail ? 'Sending...' : 'Send Email'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Jobs;
