import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { generateColdEmailApi, sendColdEmailApi, previewAtsResumeApi } from '../services/job.api';
import '../styles/jobs.scss';

/** Renders only what the source actually published. */
const orNull = (value) => {
    const text = String(value ?? '').trim();
    return text && text !== 'null' && text !== 'undefined' ? text : null;
};

/**
 * LinkedIn publishes an ISO date and Wellfound a relative phrase, so postings were
 * showing "2026-06-26" next to "2 weeks ago". ageDays is derived from whichever the
 * source gave, so it renders both on one scale.
 */
const postedLabel = (job) => {
    const days = job.ageDays;
    if (!Number.isFinite(days)) return orNull(job.postedAt);
    if (days <= 0) return 'Posted today';
    if (days === 1) return 'Posted yesterday';
    if (days < 7) return `Posted ${days} days ago`;
    if (days < 14) return 'Posted last week';
    if (days < 60) return `Posted ${Math.round(days / 7)} weeks ago`;
    return `Posted ${Math.round(days / 30)} months ago`;
};

/**
 * The backend only ever returns a verified, absolute posting URL, so there is
 * nothing left to repair here. It used to synthesise a search-results URL when the
 * link was missing, which sent applicants to a generic listing page that often did
 * not contain the job they clicked on.
 */
const applyUrlOf = (job) => {
    const url = String(job.link || '').trim();
    return /^https:\/\//.test(url) ? url : null;
};

const PLATFORM_CLASS = {
    'Naukri.com': 'platform-badge--naukri',
    LinkedIn: 'platform-badge--linkedin',
    Wellfound: 'platform-badge--wellfound',
    Indeed: 'platform-badge--indeed'
};

const JobCard = ({ job, onColdEmail }) => {
    const platformClass = PLATFORM_CLASS[job.platform] || 'platform-badge--direct';
    const scoreColor =
        job.matchScore >= 80 ? 'score--high' :
        job.matchScore >= 60 ? 'score--mid' : 'score--low';

    const applyUrl = applyUrlOf(job);

    return (
        <div className="job-card">
            <div className="job-card__header">
                <div className="job-card__title-group">
                    <div className="job-card__badges">
                        <span className={`platform-badge ${platformClass}`}>{job.platform}</span>
                    </div>
                    <h2>{job.title}</h2>
                    <div className="company-info">
                        <span>🏢 {job.company}</span>
                        {orNull(job.location) && <span>📍 {orNull(job.location)}</span>}
                        {orNull(job.exp) && <span>⏳ {orNull(job.exp)}</span>}
                        {orNull(job.employmentType) && <span>🕒 {orNull(job.employmentType)}</span>}
                        {orNull(job.salaryRange) && <span>💰 {orNull(job.salaryRange)}</span>}
                        {orNull(job.postedAt) && <span>🗓️ {postedLabel(job)}</span>}
                    </div>
                    {/* Makes a merge visible. Without it, collapsing duplicates looks like a
                        result went missing. */}
                    {job.alsoOn && job.alsoOn.length > 0 && (
                        <p className="job-card__also-on">
                            Also posted on {job.alsoOn.join(', ')}
                        </p>
                    )}
                </div>
                <div className="job-card__score">
                    <div className={`score-pill ${scoreColor}`}>{job.matchScore}%</div>
                    <span className="label">
                        Match Score
                    </span>
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
                {applyUrl ? (
                    <a href={applyUrl} target="_blank" rel="noopener noreferrer" className="apply-link">
                        🔗 View Original Post &amp; Apply
                    </a>
                ) : (
                    <span className="apply-link apply-link--disabled" title="This posting did not expose a direct link">
                        🔗 Link unavailable
                    </span>
                )}
                <button onClick={() => onColdEmail(job)} className="cold-email-btn">
                    ✉️ Cold Email Founder
                </button>
            </div>
        </div>
    );
};

const Jobs = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const [jobs, setJobs] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [diagnostics, setDiagnostics] = useState(null);
    const [notice, setNotice] = useState('');
    const [profile, setProfile] = useState({ resumeText: '', selfDescription: '' });
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
    const [errorMsg, setErrorMsg] = useState('');
    const [previewUrl, setPreviewUrl] = useState('');

    // Resume attachment state
    const [resumeSource, setResumeSource] = useState('generated');
    const [ownResume, setOwnResume] = useState(null);
    const [buildingPreview, setBuildingPreview] = useState(false);
    const ownResumeInputRef = useRef(null);

    useEffect(() => {
        // Load results from route state or sessionStorage
        if (location.state?.jobs) {
            const nextJobs = location.state.jobs || [];

            setJobs(nextJobs);
            setSearchQuery(location.state.searchQuery || 'Software Role');
            setDiagnostics(location.state.diagnostics || null);
            setNotice(location.state.notice || '');

            const nextProfile = {
                resumeText: location.state.resumeText || '',
                selfDescription: location.state.selfDescription || ''
            };
            setProfile(nextProfile);

            sessionStorage.setItem('careerlens_jobs', JSON.stringify(nextJobs));
            sessionStorage.setItem('careerlens_query', location.state.searchQuery || '');
            sessionStorage.setItem('careerlens_diagnostics', JSON.stringify(location.state.diagnostics || null));
            sessionStorage.setItem('careerlens_profile', JSON.stringify(nextProfile));
        } else {
            const savedJobs = sessionStorage.getItem('careerlens_jobs');
            const savedQuery = sessionStorage.getItem('careerlens_query');
            const savedDiagnostics = sessionStorage.getItem('careerlens_diagnostics');
            const savedProfile = sessionStorage.getItem('careerlens_profile');
            if (savedJobs) {
                if (savedJobs) setJobs(JSON.parse(savedJobs));
                setSearchQuery(savedQuery || 'Software Role');
                if (savedDiagnostics) setDiagnostics(JSON.parse(savedDiagnostics));
                if (savedProfile) setProfile(JSON.parse(savedProfile));
            }
        }
    }, [location.state]);

    /** Names the boards that turned us away, so a partial list is not shown as complete. */
    const blockedPlatforms = diagnostics?.blocked?.length ? diagnostics.blocked.join(', ') : '';
    const searchedPlatforms = diagnostics?.platforms
        ? Object.entries(diagnostics.platforms).filter(([, count]) => count > 0).map(([name]) => name)
        : [];

    const totalResults = jobs.length;
    const hasProfile = Boolean(profile.resumeText.trim() || profile.selfDescription.trim());

    const openColdEmailModal = (job) => {
        setSelectedJob(job);
        setRecipientName('Founder / Hiring Manager');
        setRecipientRole('Founder & CEO');
        setToEmail('');
        setSubject(`Application for ${job.title} position`);
        setBody(`Hi [Founder Name],\n\nI am writing to express my interest in the ${job.title} role at ${job.company}.\n\nBest regards,\n[Your Name]`);
        setStatusMsg('');
        setErrorMsg('');
        setPreviewUrl('');
        // Default to the ATS resume when we have the profile to build one from.
        setResumeSource(hasProfile ? 'generated' : 'upload');
        setOwnResume(null);
        setModalOpen(true);
    };

    const handleGenerateColdEmail = async () => {
        if (!selectedJob) return;
        setGeneratingEmail(true);
        setErrorMsg('');
        try {
            const res = await generateColdEmailApi({
                recipientName,
                recipientRole,
                jobTitle: selectedJob.title,
                jobDescription: selectedJob.jobDescription || selectedJob.summary,
                companyName: selectedJob.company,
                // Without these the model has no candidate facts to work from and
                // fabricates experience the applicant would be sending to an employer.
                resumeText: profile.resumeText,
                selfDescription: profile.selfDescription
            });

            if (res && res.subject && res.body) {
                setSubject(res.subject);
                setBody(res.body);
            }
        } catch (err) {
            console.error('Error generating cold email:', err);
            setErrorMsg(err.response?.data?.message || 'Failed to generate email. Please try again.');
        } finally {
            setGeneratingEmail(false);
        }
    };

    const handlePreviewAtsResume = async () => {
        if (!selectedJob) return;
        setBuildingPreview(true);
        setErrorMsg('');
        try {
            const blob = await previewAtsResumeApi({
                resumeText: profile.resumeText,
                selfDescription: profile.selfDescription,
                // Tailored to this exact posting, which is the point of previewing it here.
                jobDescription: selectedJob.jobDescription || selectedJob.summary
            });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank', 'noopener');
            // Revoked on a delay so the new tab has time to load it.
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (err) {
            console.error('Error building ATS resume:', err);
            // The response is a blob even on failure, so the JSON message has to be read out of it.
            let message = 'Failed to build the ATS resume.';
            try {
                const asText = await err.response?.data?.text?.();
                if (asText) message = JSON.parse(asText).message || message;
            } catch { /* keep the default message */ }
            setErrorMsg(message);
        } finally {
            setBuildingPreview(false);
        }
    };

    const handleSendViaClient = () => {
        if (!subject || !body) return;
        const mailtoUrl = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(mailtoUrl, '_blank');
    };

    const handleDirectSend = async () => {
        if (!toEmail || !toEmail.trim()) {
            setErrorMsg('Please enter a recipient email address.');
            return;
        }
        if (resumeSource === 'upload' && !ownResume) {
            setErrorMsg('Please choose the resume PDF you want to attach.');
            return;
        }
        setSendingEmail(true);
        setStatusMsg('');
        setErrorMsg('');
        setPreviewUrl('');
        try {
            const res = await sendColdEmailApi({
                toEmail,
                subject,
                body,
                resumeSource,
                resumeFile: ownResume,
                resumeText: profile.resumeText,
                selfDescription: profile.selfDescription,
                jobDescription: selectedJob?.jobDescription || selectedJob?.summary || ''
            });
            setStatusMsg(res.message || 'Email dispatched successfully!');
            if (res.previewUrl) setPreviewUrl(res.previewUrl);
        } catch (err) {
            console.error('Error sending email:', err);
            setErrorMsg(err.response?.data?.message || 'Failed to send email.');
        } finally {
            setSendingEmail(false);
        }
    };

    const handleCopyEmail = () => {
        const fullText = `Subject: ${subject}\n\n${body}`;
        navigator.clipboard.writeText(fullText);
        setStatusMsg('Cold email text copied to clipboard.');
    };

    const renderSection = (title, list, emptyMessage) => (
        <section className="jobs-section">
            <h2 className="jobs-section__title">
                {title} <span className="jobs-section__count">{list.length}</span>
            </h2>
            {list.length === 0 ? (
                <p className="jobs-section__empty">{emptyMessage}</p>
            ) : (
                <div className="jobs-grid">
                    {list.map((job, idx) => (
                        <JobCard key={job.id || idx} job={job} onColdEmail={openColdEmailModal} />
                    ))}
                </div>
            )}
        </section>
    );

    return (
        <div className="jobs-page">
            {/* Header */}
            <header className="jobs-header">
                <span className="back-link" onClick={() => navigate('/')}>
                    &larr; Back to Dashboard
                </span>
                <h1>Matched Jobs</h1>
                <p>
                    {totalResults > 0 ? (
                        <>
                            {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} for{' '}
                            <span className="query-badge">{searchQuery}</span>
                            {searchedPlatforms.length > 0 && <> from {searchedPlatforms.join(', ')}</>}
                        </>
                    ) : (
                        <>Searching for <span className="query-badge">{searchQuery}</span></>
                    )}
                </p>
                {blockedPlatforms && (
                    <p className="jobs-notice">
                        ⚠️ {blockedPlatforms} blocked our request for this search, so its postings are missing from these results.
                    </p>
                )}
            </header>

            {totalResults === 0 ? (
                <div className="jobs-header">
                    <p>
                        {notice
                            ? notice
                            : `No live openings matched "${searchQuery}" right now. Job boards turn over daily — try again later, or broaden your self-description to widen the search.`}
                    </p>
                    <p>
                        <span className="back-link" onClick={() => navigate('/')}>Start a new search</span>
                    </p>
                </div>
            ) : (
                <>
                    {renderSection(
                        'Jobs',
                        jobs,
                        `No full-time openings matched "${searchQuery}" in this search.`
                    )}

                </>
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
                                <div className="email-modal__status">
                                    {statusMsg}
                                    {previewUrl && (
                                        <div style={{ marginTop: '0.25rem' }}>
                                            🔗 <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                                                Click here to preview the sent email on Ethereal
                                            </a>
                                        </div>
                                    )}
                                </div>
                            )}
                            {errorMsg && <div className="email-modal__error">{errorMsg}</div>}

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

                            {/* Resume attachment */}
                            <div className="resume-picker">
                                <label className="resume-picker__label">Resume to attach</label>

                                <label className={`resume-option ${resumeSource === 'generated' ? 'resume-option--active' : ''} ${hasProfile ? '' : 'resume-option--disabled'}`}>
                                    <input
                                        type="radio"
                                        name="resumeSource"
                                        value="generated"
                                        checked={resumeSource === 'generated'}
                                        disabled={!hasProfile}
                                        onChange={() => setResumeSource('generated')}
                                    />
                                    <span>
                                        <strong>Use our ATS-friendly resume</strong>
                                        <em>
                                            {hasProfile
                                                ? `Built from your profile and tailored to this ${selectedJob.company} posting. Single column, standard headings, no tables or graphics — machine-readable by design.`
                                                : 'Unavailable: run a job search with your resume or self-description first.'}
                                        </em>
                                    </span>
                                </label>

                                <label className={`resume-option ${resumeSource === 'upload' ? 'resume-option--active' : ''}`}>
                                    <input
                                        type="radio"
                                        name="resumeSource"
                                        value="upload"
                                        checked={resumeSource === 'upload'}
                                        onChange={() => setResumeSource('upload')}
                                    />
                                    <span>
                                        <strong>Attach my own resume</strong>
                                        <em>Your PDF, sent exactly as it is (max 3 MB).</em>
                                    </span>
                                </label>

                                <label className={`resume-option ${resumeSource === 'none' ? 'resume-option--active' : ''}`}>
                                    <input
                                        type="radio"
                                        name="resumeSource"
                                        value="none"
                                        checked={resumeSource === 'none'}
                                        onChange={() => setResumeSource('none')}
                                    />
                                    <span>
                                        <strong>No attachment</strong>
                                        <em>Send the message text only.</em>
                                    </span>
                                </label>

                                {resumeSource === 'upload' && (
                                    <div className="resume-picker__upload">
                                        <input
                                            ref={ownResumeInputRef}
                                            type="file"
                                            accept="application/pdf,.pdf"
                                            onChange={(e) => setOwnResume(e.target.files?.[0] || null)}
                                        />
                                        {ownResume && (
                                            <span className="resume-picker__filename">
                                                {ownResume.name} ({Math.round(ownResume.size / 1024)} KB)
                                            </span>
                                        )}
                                    </div>
                                )}

                                {resumeSource === 'generated' && hasProfile && (
                                    <button
                                        className="btn-secondary resume-picker__preview"
                                        onClick={handlePreviewAtsResume}
                                        disabled={buildingPreview}
                                    >
                                        {buildingPreview ? 'Building resume...' : '📄 Preview ATS resume'}
                                    </button>
                                )}
                            </div>

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
                            {/* mailto: cannot carry an attachment — the resume only travels on "Send Email". */}
                            <button
                                className="btn-secondary"
                                onClick={handleSendViaClient}
                                title="Opens your mail app with the text. Attachments are not supported by mailto: — add the resume yourself, or use Send Email."
                            >
                                🚀 Open in Email Client (text only)
                            </button>
                            <button
                                className="btn-primary"
                                onClick={handleDirectSend}
                                disabled={sendingEmail || (resumeSource === 'upload' && !ownResume)}
                            >
                                {sendingEmail
                                    ? 'Sending...'
                                    : resumeSource === 'none' ? 'Send Email' : 'Send Email + Resume'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Jobs;
