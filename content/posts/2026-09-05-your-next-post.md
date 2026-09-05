---
title: Your Next Post
slug: your-next-post
date: 2026-09-05
description: One or two sentences shown in the post list, in search previews and on social cards.
tags: [go]
draft: true
---

Write in plain Markdown. Headings, lists, links, images, block quotes and fenced code blocks all work.

```go
package main

import "fmt"

func main() {
	done := make(chan struct{})
	go func() {
		fmt.Println("hello from a goroutine")
		close(done)
	}()
	<-done
}
```

Drop images into `static/media/` and reference them as `/media/name.webp`.
Set `draft: false` (or delete the line) when you're ready to publish.
