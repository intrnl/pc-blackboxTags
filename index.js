'use strict'

const { Plugin } = require('powercord/entities')
const { get: requestGET } = require('powercord/http')
const { getOwnerInstance, sleep } = require('powercord/util')
const { getModule } = require('powercord/webpack')
const { inject, uninject } = require('powercord/injector')

const cssom = require('./dependencies/cssom.js')

class DerealizedTags extends Plugin {
  async startPlugin () {
    await this.patchMessageContent()
    this.fetchTags()

    setInterval(() => this.fetchTags(), 1.8e+6)
  }

  pluginWillUnload () {
    uninject('pc-derealizedTags-MessageContent-componentDidMount')
    uninject('pc-derealizedTags-MessageContent-render')

    clearInterval(() => this.fetchTags())
  }


  // Tag store
  get tagStore () {
    return this._tags || (this._tags = new Map)
  }

  async fetchTags () {
    if (this.currentlyFetching) return

    this.currentlyFetching = true
    let css

    while (!css) {
      try {
        const req = await requestGET('https://raw.githubusercontent.com/monstrousdev/themes/master/addons/user-tags.css')
          .set('If-None-Match', this.tagEtag || null)

        // Don't continue if the response says that the previous content is still fresh.
        if (req.statusCode === 304) {
          this.currentlyFetching = false
          return
        }

        css = req.body
          .toString()
          .replace(/var\(--mc\)/g, 'var(--mc, var(--main-color, #fff))')
          .replace(/var\(--primary-color\)/g, 'var(--primary-color, #7289da)')

        this.tagEtag = req.headers.etag
      } catch (err) {
        this.error('Failed to fetch tags, retrying in 60 seconds.\n', err)
        await sleep(60 * 1000)
      }
    }

    this.tagStore.clear()
    
    const obj = cssom.parse(css)
    const rules = obj.cssRules

    rules
      .filter((rule) =>
        rule.style &&
        rule.style.content &&
        rule.style.content !== '"}"' &&
        rule.style.content !== "''" &&
        rule.style.content !== '""'
      )
      .map((rule) => {
        const { selectorText, style } = rule

        return {
          id: (/\[style\*=(?:"|')(?:avatars\/)?([0-9]+)(?:"|')]/).exec(selectorText)[1],
          name: style.content.slice(1, -1),
          style: {
            background: style.background || style['background-image'] || style['background-color'] || null,
            color: style.color || null,
          },
        }
      })
      .forEach((tag) => {
        this.tagStore.set(tag.id, tag)
      })

    this.forceUpdateAll()
    this.log('Fetched tags')
    this.currentlyFetching = false
  }


  // General internal stuff
  async forceUpdateAll () {
    const elements = [
      ...document.querySelectorAll('.message-1PNnaP')
    ]

    for (const elem of elements) {
      const instance = getOwnerInstance(elem)
      instance.forceUpdate()
    }
  }


  // Patch message content
  async patchMessageContent () {
    const MessageContent = getOwnerInstance(await this.waitFor('.message-1PNnaP'))
    const classes = {
      ...await getModule(['botTagRegular']),
      ...await getModule(['botTagCozy', 'botTagCompact'])
    }

    const _this = this
    function tagsRenderer (args, res) {
      if (!this.ref || !this.props || !this.props.message) return res

      const { message: { author }, isCompact } = this.props
      const tag = _this.tagStore.get(author.id)

      if (!tag) return res

      const tagCheck = _this.nodeFilter(this.ref,
        filter =>
          filter.className && typeof filter.className === 'string' &&
          filter.className.includes('derealized-tag')
      )

      if (tagCheck) return res

      const usernameElement = _this.nodeFilter(this.ref,
        filter =>
          filter.className && typeof filter.className === 'string' &&
          filter.className.includes('username-')
      )

      if (!usernameElement) return res

      const botElement = document.createElement('span')
      botElement.classList.add(
        'derealized-tag',
        ...classes.botTagRegular.split(' '),
        ...isCompact ? classes.botTagCompact.split(' ') : classes.botTagCozy.split(' ')
      )
      botElement.innerText = tag.name

      if (tag.style) {
        botElement.style.background = tag.style.background || '#000'
        botElement.style.color = tag.style.color || '#fff'
      }

      usernameElement.insertAdjacentElement(isCompact ? 'beforebegin' : 'afterend', botElement)

      return res
    }

    inject('pc-derealizedTags-MessageContent-componentDidMount', Object.getPrototypeOf(MessageContent), 'componentDidMount', tagsRenderer)
    inject('pc-derealizedTags-MessageContent-render', Object.getPrototypeOf(MessageContent), 'render', tagsRenderer)

    this.log('Patched MessageContent')
  }


  // Utils, taken from BDv2
  async waitFor (query, ms = 2500) {
    let elem

    while (!(elem = document.querySelector(query))) {
      await sleep(ms)
    }

    return elem
  }

  nodeFilter (node, filter) {
    const treeWalker = document.createTreeWalker(node, NodeFilter.SHOW_ALL)

    while (treeWalker.nextNode()) {
      const el = treeWalker.currentNode
      if (filter(el)) return el
    }
  }
}

module.exports = DerealizedTags
