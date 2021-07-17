---
layout: post
title: 🐻 Go data validation and filtering with gookit/validate
date: 2021-07-11 15:58 +0700
categories: Go Input-Validaiton
---
When it comes to data validation and filtering, Go approach is not as straightforward as it seems.

Recently I needed to add filtering along with [validator.v2](https://godoc.org/gopkg.in/validator.v2) input validation and
I wanted to go with the struct-tags strcture to keep the constietency throughout
the project and so I decided to give [gookit/validate](https://pkg.go.dev/github.com/gookit/validate) a shot.


You need to simply define a your validations and filters as struct-tags and If you need a custom validation / filtering you just definea  function on a struct value/pointer as below:

```go
type UserForm struct {
Name string `validate:"required|nameLike" filter:"trim|escapeJs|escapeHtml"`
Phone string `validate:"required|min:8" filter:"removeCountryCode"`
}

func (u UserForm) nameLike(val string) bool {
 re := regexp.MustCompile("something")
 return re.MatchString(val)
}

func (u UserForm) removeCountryCode(val string) string {
    return removeCountryCode(val)
}

```

As you can see, with gookit/validate, it's really straightforward to add input
validaiton and filtering the way you'd imagine them to work!


----------
I hope you enjoyed this post! If you want to start a new project or you want to
add new features and maintain your old system you can hire me through
<a href="https://upwork.com/fl/al3rez" style="color: rgb(20, 168, 0);">Upwork!</a>
