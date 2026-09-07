# Brett Bergin

**Email:** brettberginbc@yahoo.com | **Phone:** (408) 300-3210 | **Location:** Bakersfield, CA  
**GitHub:** https://github.com/brettbergin/ | **GPG:** 5A35 BE3F 200D 3389 EB4D 8F9A 1354 C7F6 593D 4B54

## Professional Summary

Senior application security engineer with 10+ years developing and operationalizing comprehensive security programs for enterprise organizations. Proven expertise in vulnerability management, penetration testing, security automation, and DevSecOps at scale. Strong technical background in cloud security, risk assessment, security architecture, and distributed systems with a track record of implementing Zero Trust security solutions supporting millions of users. Experienced in compliance frameworks including GDPR, SOX, and PCI-DSS. Active developer of AI-powered security tools and Model Context Protocol (MCP) servers for enhanced productivity in red team operations, network security monitoring, and security automation workflows.

## Key Achievements

- Designed OAuth-based identity solution supporting 10+ million users
- Built automated vulnerability management program with comprehensive reporting and distribution
- Deployed vulnerability scanning infrastructure covering 500,000+ compute endpoints in OpenStack environment
- Implemented Splunk-based security analytics platform for web traffic analysis
- Developed IoT network forensics solution for traffic pattern anomaly detection and protocol analysis
- Created automated network traffic capture system with deep packet inspection integration
- Architected vulnerability tracking solution mapping security issues to system owners across enterprise

## Core Competencies

| Application Security | Vulnerability Management | Security Operations |
|---------------------|-------------------------|-------------------|
| Threat Modeling | Penetration Testing | Threat Detection |
| Security Automation | Risk Assessment | Incident Response |
| SAST/DAST/IAST | Network Forensics | SIEM/SOAR |
| DevSecOps | Compliance Management | Threat Hunting |

## Open Source Projects

| Project | Description |
|---------|-------------|
| [adversary-mcp-server](https://github.com/brettbergin/adversary-mcp-server) | Model Context Protocol server for adversarial security testing and red team operations |
| [pihole-mcp-server](https://github.com/brettbergin/pihole-mcp-server) | MCP integration server for Pi-hole DNS filtering and network security monitoring |
| [ChatGPTCodeScanner](https://github.com/brettbergin/ChatGPTCodeScanner) | AI-powered static analysis tool using ChatGPT, Python & Flask |
| [CalGEMDataIngest](https://github.com/brettbergin/CalGEMDataIngest) | Data pipeline for California Department of Conservation using Python & Jupyter |
| [SystemStatsAPI](https://github.com/brettbergin/SystemStatsAPI) | System telemetry collection and API service in Python & Flask |
| [DisableMySSH](https://github.com/brettbergin/DisableMySSH) | AWS security automation to disable SSH access from 0.0.0.0/0 |
| [DisableMySSH-Infra](https://github.com/brettbergin/DisableMySSH-Infra) | Terraform infrastructure automation for DisableMySSH |

## Technical Skills

**Security Tools:** Burp Suite Professional, Metasploit Framework, OWASP ZAP, SQLMap, Nmap, Bettercap, MITMProxy, TCPDump  
**SIEM/Analytics:** Splunk, ELK Stack, SOAR platforms  
**Cloud Security:** AWS Security Hub, AWS GuardDuty, Azure Security Center, Cloud Security Posture Management  
**Platforms:** Kali Linux, AWS, Azure, OpenStack, Docker, Kubernetes  
**Languages:** Python, SQL, Bash, JavaScript, PowerShell  
**Frameworks:** Flask, Terraform, Ansible, Jenkins  
**Security Testing:** SAST, DAST, IAST, Static Code Analysis, Dynamic Analysis  
**Compliance:** ISO 27001, NIST Cybersecurity Framework, PCI-DSS, GDPR, SOX  
**Specializations:** Zero Trust Architecture, DevSecOps, IAM, Multi-Factor Authentication, Risk Assessment, Security Architecture, Threat Hunting, Incident Response, Security Governance

## Work Experience

### Senior Application Security Engineer
**OnePay** - Remote  
*September 2024 - Present*

- Lead application security initiatives for fintech payment processing platform serving financial APIs
- Implement PCI-DSS compliance controls and security frameworks for payment card data protection
- Design and deploy DevSecOps practices with security testing automation in CI/CD pipelines

### Senior Application Security Engineer
**Cisco Systems Inc. / Meraki** - Remote  
*April 2022 - September 2024*

- Implemented SAST/DAST tools with CI/CD integration for enhanced vulnerability detection across cloud infrastructure
- Designed and deployed Zero Trust security controls and multi-factor authentication frameworks
- Led red team exercises and penetration testing initiatives for cloud infrastructure and APIs

### Information Security Engineer
**Mode Analytics** - Remote  
*January 2020 - February 2022*

- Developed company-wide threat model identifying attack vectors and OWASP Top 10 threat scenarios
- Managed penetration testing and bug bounty programs with validation and remediation workflows
- Created automated security review process with SAST/DAST integration and SLA reporting

### Director, Application & Product Security
**Ring.com** - Remote  
*April 2018 - November 2019*

- Established application and offensive security teams through strategic hiring and vendor partnerships
- Developed penetration testing program for consumer IoT products and cloud services
- Created managed bug bounty strategy for secure product launches

### Senior Manager, Information Security
**Ring.com** - Remote  
*January 2017 - April 2018*

- Built comprehensive security operations framework and integrated security assessments into release cycles
- Developed automated SAST solution with CI/CD pipeline integration
- Designed custom risk ranking methodology combining SLA requirements and CVSS scoring

### MTS 1, Data Science Engineer – Security Data Science
**eBay Inc.** - Remote  
*March 2016 - January 2017*

- Created executive dashboards and actionable reports for threat and risk exposure analysis
- Developed risk and threat data models to assess financial, legal, and brand impact scenarios
- Built data aggregation pipelines for predictive security breach impact modeling

### MTS 1, Information Security Engineer – Vulnerability Management
**eBay Inc.** - San Jose, CA  
*November 2014 - March 2016*

- Designed high-performance vulnerability scanning architecture covering 500,000+ endpoints with concurrent processing
- Created automated patch management integration for security patch deployment
- Developed risk ranking algorithms to prioritize vulnerability remediation efforts

### Information Security Engineer 3 – Application Security
**eBay Inc.** - San Jose, CA  
*December 2012 - November 2014*

- Developed penetration testing methodologies and conducted assessments on mobile applications and web services
- Created security policies and remediation procedures for operational teams
- Integrated security assessments into software development lifecycle processes

## References

**Robert Meives** | Senior Manager, Engineering | Charter Communications  
San Luis Obispo, CA | (805) 305-8853 | Rob.Meives@chartercom.com

**Lance Harris** | Chief Information Security Officer | Esurance  
San Francisco, CA | mr.lance.harris@gmail.com

**Steve Pace** | Senior Vice President, Global Sales | Core Security Technologies  
Boston, MA | (626) 200-5124 | space@coresecurity.com 

## Repo layout

This repository holds two things: the resume itself, and the website that
publishes it.

- `resume.md` — the human-authored original and the source of truth for the
  content. Everything else that shows the resume is a transcription or an
  export of this file.
- `resume.html` and `resume.pdf` — rendered exports of `resume.md`.
  `resume.pdf` is the file the site's "Download PDF" button serves:
  `site/vite/resume-pdf.ts` reads it from the repo root at build time and
  emits it into `site/dist/`, so it is deliberately **not** duplicated under
  `site/public/` — one copy in git, no way for a second one to go stale.
- `site/` — the Vite + React + TypeScript frontend deployed to GitHub Pages.
  See [`site/README.md`](site/README.md) for the detail.
- `site/public/` — the files published at the site root as-is: `favicon.svg`
  and the generated `og-image.png` / `apple-touch-icon.png` behind the SEO and
  social-preview tags, plus `robots.txt` and `sitemap.xml`. The two PNGs are
  committed but re-derivable — `npm run generate:images` redraws them from
  `site/src/data/`.
- `.github/workflows/` — `ci.yml` is the pull-request gate; `deploy-pages.yml`
  builds `site/` and publishes it to Pages.

The live site: <https://brettbergin.github.io/resume/>

```bash
cd site
npm install     # install dependencies
npm run dev     # local dev server
npm run build   # production build into site/dist
```

### Keeping content in sync

`resume.md` and `site/src/data/resume.ts` are transcriptions of each other,
not generated from one another, so a content change has to edit **both, in the
same commit** — otherwise the page and the resume disagree. `resume.html` and
`resume.pdf` are regenerated from `resume.md` by hand as well. The
`References` section of `resume.md` is deliberately not modelled in
`resume.ts` and has no counterpart on the site.

`site/test/resume-md-sync.test.ts` is that rule as a test: every string
`resume.ts` transcribes — the achievement texts, each role's highlights, the
skill items, project names and URLs, the date ranges, the contact details —
has to appear verbatim somewhere in `resume.md`. A bullet reworded in one file
and not the other fails a check at the moment it is introduced, instead of
waiting for someone to read both documents side by side.

The check is one-directional (markdown with no counterpart in the data is not
a failure) and deliberately leaves some things out: the `metric` callouts on
achievements, which are editorial condensations reworded to stand alone; the
published PDF's file name, which is a build artifact rather than a line of the
resume; the `resume.html` and `resume.pdf` exports, which are renderings
rather than transcriptions; and the `References` section, which `resume.ts`
does not model at all.

So the transcription is checked, but the rest is still manual: `resume.ts` is
written by hand, and `resume.html` / `resume.pdf` are regenerated by hand.
Automating that — generating `resume.ts` (and the exports) from `resume.md` —
would be a separate change. The check runs under `npm test` in `site/`, and
**CI does not run the Vitest suite today** (it lints, type-checks and builds),
so run `npm test` locally before opening a pull request.
