/*
 * Resume content, transcribed from `resume.md` at the repo root. That file
 * stays the human-authored original; this one is what the site's sections
 * render from, so the two must be edited together.
 * `test/resume-md-sync.test.ts` enforces that: every string exported here has
 * to appear verbatim in `resume.md`, so an edit to one file and not the other
 * fails a test.
 *
 * The `References` section of `resume.md` is deliberately not modelled here:
 * it is three third parties' personal phone numbers and email addresses, and
 * publishing those on the site is not something they consented to.
 */

import type {
  Achievement,
  ContactInfo,
  Experience,
  Project,
  SkillGroup,
  Summary,
} from './types.ts'

export const contact: ContactInfo = {
  email: 'brettberginbc@yahoo.com',
  phone: '(408) 300-3210',
  location: 'Bakersfield, CA',
  githubUrl: 'https://github.com/brettbergin/',
  gpgFingerprint: '5A35 BE3F 200D 3389 EB4D 8F9A 1354 C7F6 593D 4B54',
}

export const summary: Summary = {
  name: 'Brett Bergin',
  title: 'Senior Application Security Engineer',
  professionalSummary:
    'Senior application security engineer with 10+ years developing and operationalizing comprehensive security programs for enterprise organizations. Proven expertise in vulnerability management, penetration testing, security automation, and DevSecOps at scale. Strong technical background in cloud security, risk assessment, security architecture, and distributed systems with a track record of implementing Zero Trust security solutions supporting millions of users. Experienced in compliance frameworks including GDPR, SOX, and PCI-DSS. Active developer of AI-powered security tools and Model Context Protocol (MCP) servers for enhanced productivity in red team operations, network security monitoring, and security automation workflows.',
  resumePdfFileName: 'resume.pdf',
}

export const achievements: Achievement[] = [
  {
    text: 'Designed OAuth-based identity solution supporting 10+ million users',
    metric: '10+ million users',
  },
  {
    text: 'Built automated vulnerability management program with comprehensive reporting and distribution',
  },
  {
    text: 'Deployed vulnerability scanning infrastructure covering 500,000+ compute endpoints in OpenStack environment',
    metric: '500,000+ endpoints',
  },
  {
    text: 'Implemented Splunk-based security analytics platform for web traffic analysis',
  },
  {
    text: 'Developed IoT network forensics solution for traffic pattern anomaly detection and protocol analysis',
  },
  {
    text: 'Created automated network traffic capture system with deep packet inspection integration',
  },
  {
    text: 'Architected vulnerability tracking solution mapping security issues to system owners across enterprise',
  },
]

/** The Core Competencies table, read column-wise: one group per header cell. */
export const competencies: SkillGroup[] = [
  {
    label: 'Application Security',
    items: [
      'Threat Modeling',
      'Security Automation',
      'SAST/DAST/IAST',
      'DevSecOps',
    ],
  },
  {
    label: 'Vulnerability Management',
    items: [
      'Penetration Testing',
      'Risk Assessment',
      'Network Forensics',
      'Compliance Management',
    ],
  },
  {
    label: 'Security Operations',
    items: [
      'Threat Detection',
      'Incident Response',
      'SIEM/SOAR',
      'Threat Hunting',
    ],
  },
]

export const technicalSkills: SkillGroup[] = [
  {
    label: 'Security Tools',
    items: [
      'Burp Suite Professional',
      'Metasploit Framework',
      'OWASP ZAP',
      'SQLMap',
      'Nmap',
      'Bettercap',
      'MITMProxy',
      'TCPDump',
    ],
  },
  {
    label: 'SIEM/Analytics',
    items: ['Splunk', 'ELK Stack', 'SOAR platforms'],
  },
  {
    label: 'Cloud Security',
    items: [
      'AWS Security Hub',
      'AWS GuardDuty',
      'Azure Security Center',
      'Cloud Security Posture Management',
    ],
  },
  {
    label: 'Platforms',
    items: [
      'Kali Linux',
      'AWS',
      'Azure',
      'OpenStack',
      'Docker',
      'Kubernetes',
    ],
  },
  {
    label: 'Languages',
    items: ['Python', 'SQL', 'Bash', 'JavaScript', 'PowerShell'],
  },
  {
    label: 'Frameworks',
    items: ['Flask', 'Terraform', 'Ansible', 'Jenkins'],
  },
  {
    label: 'Security Testing',
    items: [
      'SAST',
      'DAST',
      'IAST',
      'Static Code Analysis',
      'Dynamic Analysis',
    ],
  },
  {
    label: 'Compliance',
    items: [
      'ISO 27001',
      'NIST Cybersecurity Framework',
      'PCI-DSS',
      'GDPR',
      'SOX',
    ],
  },
  {
    label: 'Specializations',
    items: [
      'Zero Trust Architecture',
      'IAM',
      'Multi-Factor Authentication',
      'Security Architecture',
      'Security Governance',
    ],
  },
]

/** Most recent role first, matching `resume.md`. */
export const experiences: Experience[] = [
  {
    company: 'OnePay',
    title: 'Senior Application Security Engineer',
    dates: 'September 2024 - Present',
    location: 'Remote',
    highlights: [
      'Lead application security initiatives for fintech payment processing platform serving financial APIs',
      'Implement PCI-DSS compliance controls and security frameworks for payment card data protection',
      'Design and deploy DevSecOps practices with security testing automation in CI/CD pipelines',
    ],
  },
  {
    company: 'Cisco Systems Inc. / Meraki',
    title: 'Senior Application Security Engineer',
    dates: 'April 2022 - September 2024',
    location: 'Remote',
    highlights: [
      'Implemented SAST/DAST tools with CI/CD integration for enhanced vulnerability detection across cloud infrastructure',
      'Designed and deployed Zero Trust security controls and multi-factor authentication frameworks',
      'Led red team exercises and penetration testing initiatives for cloud infrastructure and APIs',
    ],
  },
  {
    company: 'Mode Analytics',
    title: 'Information Security Engineer',
    dates: 'January 2020 - February 2022',
    location: 'Remote',
    highlights: [
      'Developed company-wide threat model identifying attack vectors and OWASP Top 10 threat scenarios',
      'Managed penetration testing and bug bounty programs with validation and remediation workflows',
      'Created automated security review process with SAST/DAST integration and SLA reporting',
    ],
  },
  {
    company: 'Ring.com',
    title: 'Director, Application & Product Security',
    dates: 'April 2018 - November 2019',
    location: 'Remote',
    highlights: [
      'Established application and offensive security teams through strategic hiring and vendor partnerships',
      'Developed penetration testing program for consumer IoT products and cloud services',
      'Created managed bug bounty strategy for secure product launches',
    ],
  },
  {
    company: 'Ring.com',
    title: 'Senior Manager, Information Security',
    dates: 'January 2017 - April 2018',
    location: 'Remote',
    highlights: [
      'Built comprehensive security operations framework and integrated security assessments into release cycles',
      'Developed automated SAST solution with CI/CD pipeline integration',
      'Designed custom risk ranking methodology combining SLA requirements and CVSS scoring',
    ],
  },
  {
    company: 'eBay Inc.',
    title: 'MTS 1, Data Science Engineer – Security Data Science',
    dates: 'March 2016 - January 2017',
    location: 'Remote',
    highlights: [
      'Created executive dashboards and actionable reports for threat and risk exposure analysis',
      'Developed risk and threat data models to assess financial, legal, and brand impact scenarios',
      'Built data aggregation pipelines for predictive security breach impact modeling',
    ],
  },
  {
    company: 'eBay Inc.',
    title: 'MTS 1, Information Security Engineer – Vulnerability Management',
    dates: 'November 2014 - March 2016',
    location: 'San Jose, CA',
    highlights: [
      'Designed high-performance vulnerability scanning architecture covering 500,000+ endpoints with concurrent processing',
      'Created automated patch management integration for security patch deployment',
      'Developed risk ranking algorithms to prioritize vulnerability remediation efforts',
    ],
  },
  {
    company: 'eBay Inc.',
    title: 'Information Security Engineer 3 – Application Security',
    dates: 'December 2012 - November 2014',
    location: 'San Jose, CA',
    highlights: [
      'Developed penetration testing methodologies and conducted assessments on mobile applications and web services',
      'Created security policies and remediation procedures for operational teams',
      'Integrated security assessments into software development lifecycle processes',
    ],
  },
]

export const projects: Project[] = [
  {
    name: 'adversary-mcp-server',
    description:
      'Model Context Protocol server for adversarial security testing and red team operations',
    url: 'https://github.com/brettbergin/adversary-mcp-server',
  },
  {
    name: 'pihole-mcp-server',
    description:
      'MCP integration server for Pi-hole DNS filtering and network security monitoring',
    url: 'https://github.com/brettbergin/pihole-mcp-server',
  },
  {
    name: 'ChatGPTCodeScanner',
    description:
      'AI-powered static analysis tool using ChatGPT, Python & Flask',
    url: 'https://github.com/brettbergin/ChatGPTCodeScanner',
  },
  {
    name: 'CalGEMDataIngest',
    description:
      'Data pipeline for California Department of Conservation using Python & Jupyter',
    url: 'https://github.com/brettbergin/CalGEMDataIngest',
  },
  {
    name: 'SystemStatsAPI',
    description: 'System telemetry collection and API service in Python & Flask',
    url: 'https://github.com/brettbergin/SystemStatsAPI',
  },
  {
    name: 'DisableMySSH',
    description: 'AWS security automation to disable SSH access from 0.0.0.0/0',
    url: 'https://github.com/brettbergin/DisableMySSH',
  },
  {
    name: 'DisableMySSH-Infra',
    description: 'Terraform infrastructure automation for DisableMySSH',
    url: 'https://github.com/brettbergin/DisableMySSH-Infra',
  },
]
