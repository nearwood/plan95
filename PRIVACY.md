# Privacy Policy

_Last updated: June 16, 2026_

## Overview

plan95 ("the app") is a planning-poker tool currently in **internal testing**. This
policy explains how the app handles your information.

## We do not record your data

The app does **not** collect, store, sell, or share any personal data. Specifically:

- We do not maintain a database of users, sessions, votes, or activity.
- We do not use analytics, tracking pixels, or advertising.
- Room and voting state exists only in server memory while a session is active and
  is discarded when the session ends.

## Authentication

The app uses Atlassian OAuth solely to sign you in and to read the Jira issues you
ask it to load. The information involved is:

- An Atlassian access token and your basic profile (name, email, avatar), held only
  inside a signed, HTTP-only session cookie in your browser. This cookie expires
  after 8 hours.
- Jira issue details (summary and description) you explicitly request, fetched
  on demand and not persisted.

We do not store these values server-side beyond the lifetime of your request.

## Third parties

Signing in and loading issues involves Atlassian. Your use of Atlassian services is
governed by Atlassian's own privacy policy.

## Internal testing & no guarantees

The app is provided for internal testing on an "as is" and "as available" basis,
with **no guarantees** of privacy, security, availability, or fitness for any
purpose. Functionality may change or be removed at any time without notice.

## Contact

Questions about this policy can be directed to the project maintainer.
