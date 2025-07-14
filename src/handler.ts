import * as core from '@actions/core'
import { Context } from '@actions/github/lib/context'
import * as utils from './utils'
import { PullRequest } from './pull_request'
import { Client } from './types'

export interface Config {
  addReviewers: boolean
  addAssignees: boolean | string
  reviewers: string[]
  assignees: string[]
  filterLabels?: {
    include?: string[]
    exclude?: string[]
  }
  numberOfAssignees: number
  numberOfReviewers: number
  skipKeywords: string[]
  useReviewGroups: boolean
  useAssigneeGroups: boolean
  reviewGroups: { [key: string]: string[] }
  assigneeGroups: { [key: string]: string[] }
  runOnDraft?: boolean
  reviewerToLabelMap?: { [key: string]: string }
  branchesToLabelMap?: { [key: string]: string }
  releaseLabel?: string
  waitingForReviewLabel?: string
}

export async function handlePullRequest(
  client: Client,
  context: Context,
  config: Config
) {
  if (!context.payload.pull_request) {
    throw new Error('the webhook payload is not exist')
  }

  const { title, draft, user, number } = context.payload.pull_request
  const {
    skipKeywords,
    useReviewGroups,
    useAssigneeGroups,
    reviewGroups,
    assigneeGroups,
    addReviewers,
    addAssignees,
    filterLabels,
    runOnDraft,
  } = config

  if (skipKeywords && utils.includesSkipKeywords(title, skipKeywords)) {
    core.info(
      'Skips the process to add reviewers/assignees since PR title includes skip-keywords'
    )
    return
  }
  if (!runOnDraft && draft) {
    core.info(
      'Skips the process to add reviewers/assignees since PR type is draft'
    )
    return
  }

  if (useReviewGroups && !reviewGroups) {
    throw new Error(
      "Error in configuration file to do with using review groups. Expected 'reviewGroups' variable to be set because the variable 'useReviewGroups' = true."
    )
  }

  if (useAssigneeGroups && !assigneeGroups) {
    throw new Error(
      "Error in configuration file to do with using review groups. Expected 'assigneeGroups' variable to be set because the variable 'useAssigneeGroups' = true."
    )
  }

  const owner = user.login
  const pr = new PullRequest(client, context)
  const labels = new Set<string>()

  // Add labeling based on target branch
  if (config.branchesToLabelMap) {
    try {
      const targetBranch = pr.getTargetBranch()
      const label = utils.chooseLabelForTargetBranch(targetBranch, config)
      if (label) {
        labels.add(label)
        core.info(`Added branch-based label to PR #${number}: ${label}`)
      }
    } catch (error) {
      if (error instanceof Error) {
        core.warning(`Error adding branch-based label: ${error.message}`)
      }
    }
  }

  // Add labeling based on reviewers
  if (config.reviewerToLabelMap) {
    try {
      const reviewers = pr.getReviewers()
      for (const reviewer of reviewers) {
        const label = utils.chooseLabelForReviewer(reviewer, config)
        if (label) {
          labels.add(label)
          core.info(`Added reviewer-based label to PR #${number}: ${label}`)
        }
      }

      // Also check team reviewers
      const teamReviewers = pr.getTeamReviewers()
      for (const teamReviewer of teamReviewers) {
        const label = utils.chooseLabelForReviewer(teamReviewer, config)
        if (label) {
          labels.add(label)
          core.info(`Added team reviewer-based label to PR #${number}: ${label}`)
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        core.warning(`Error adding reviewer-based labels: ${error.message}`)
      }
    }
  }

  // Add release label for release/hotfix branches if configured
  if (config.releaseLabel) {
    try {
      const targetBranch = pr.getTargetBranch()
      if (targetBranch.startsWith('release') || targetBranch.startsWith('hotfix')) {
        labels.add(config.releaseLabel)
        core.info(`Added "${config.releaseLabel}" label to PR #${number}`)
      }
    } catch (error) {
      if (error instanceof Error) {
        core.warning(`Error adding release planning label: ${error.message}`)
      }
    }
  }

  // Add waiting for review label for non-draft PRs if configured
  if (config.waitingForReviewLabel && !draft) {
    labels.add(config.waitingForReviewLabel)
    core.info(`Added "${config.waitingForReviewLabel}" label to PR #${number}`)
  }

  // Apply all collected labels
  if (labels.size > 0) {
    try {
      await pr.addLabels(Array.from(labels))
      core.info(`Applied ${labels.size} labels to PR #${number}`)
    } catch (error) {
      if (error instanceof Error) {
        core.warning(`Error applying labels: ${error.message}`)
      }
    }
  }

  if (filterLabels !== undefined) {
    if (filterLabels.include !== undefined && filterLabels.include.length > 0) {
      const hasLabels = pr.hasAnyLabel(filterLabels.include)
      if (!hasLabels) {
        core.info(
          'Skips the process to add reviewers/assignees since PR is not tagged with any of the filterLabels.include'
        )
        return
      }
    }

    if (filterLabels.exclude !== undefined && filterLabels.exclude.length > 0) {
      const hasLabels = pr.hasAnyLabel(filterLabels.exclude)
      if (hasLabels) {
        core.info(
          'Skips the process to add reviewers/assignees since PR is tagged with any of the filterLabels.exclude'
        )
        return
      }
    }
  }

  if (addReviewers) {
    try {
      const reviewers = utils.chooseReviewers(owner, config)

      if (reviewers.length > 0) {
        await pr.addReviewers(reviewers)
        core.info(`Added reviewers to PR #${number}: ${reviewers.join(', ')}`)
      }
    } catch (error) {
      if (error instanceof Error) {
        core.warning(error.message)
      }
    }
  }

  if (addAssignees) {
    try {
      const assignees = utils.chooseAssignees(owner, config)

      if (assignees.length > 0) {
        await pr.addAssignees(assignees)
        core.info(`Added assignees to PR #${number}: ${assignees.join(', ')}`)
      }
    } catch (error) {
      if (error instanceof Error) {
        core.warning(error.message)
      }
    }
  }
}
