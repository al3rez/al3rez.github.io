---
layout: post
title: "\U0001F916 //go:generate MongoDB functions and hooks"
date: 2021-07-17 11:45
categories: Go MongoDB Code-Generation
---

When dealing with databases sometimes working with a ORM/ODM is a pain in the ass, so writing your own database functions comes into mind! Luckliy with `//go:generate` you can write it once and generate it multiple times for different tables/schemas.

## Code Generation



```go
// gen_basic.tpl
// Code generated DO NOT EDIT

package VAR_PKG

import (
	"context"

	"github.com/mongodb-generate/collections"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func (s Store) Create(ctx context.Context, e *collections.VAR_TYPE) error {
     s.defaults(e)
     if err := s.validations(e); err != nil {
        return err
    }
	_, err := s.db.Collection(collectionName).InsertOne(ctx, e)

	if err != nil {
		return err
	}

	return nil
}
```

Then you can generate database functions for `User` collection;

```go
package user

import (
	"context"
	"time"

	"github.com/pkg/errors"
	"go.mongodb.org/mongo-driver/bson"

	"github.com/mongodb-generate/collections"
	"github.com/mongodb-generate/store"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.uber.org/zap"
)

//go:generate ../gen/basic.sh User user

const (
	collectionName = "users"
)

type Store struct {
	db     *mongo.Database
	logger *zap.Logger
	store.Store
}

func New(db *mongo.Database, logger *zap.Logger) Store {
	return Store{
		db:     db,
		logger: logger,
		Store:  store.New(db, logger, collectionName),
	}
}

func (s Store) defaults(e *collections.User) {
	if e.ID.IsZero() {
		e.ID = primitive.NewObjectID()
	}
	if e.CreatedAt == 0 {
		e.CreatedAt = primitive.NewDateTimeFromTime(time.Now())
	}
	if e.UpdatedAt == 0 {
		e.UpdatedAt = primitive.NewDateTimeFromTime(time.Now())
	}
}

func (s Store) validations(e *collections.User) error {
	if e.User.Age >= 18 {
		return fmt.Errorf("User age must be greater than 18.")
	}
}
```

`basic.sh` is simply removes the old generate code with a new one and runs `go generate` to create a new file under the defined package directory.
```sh
#!/usr/bin/env bash

T=$1
PACK=$2
PATTERN="s#package VAR_PKG#package ${PACK}#g"
FILE=`dirname "$0"`/gen_basic.tpl

rm -f ${PACK}_gen.go || true
cat ${FILE} | sed -e s#VAR_TYPE#${T^}#g -e ${PATTERN} > ${PACK}_gen.go

```

You can change the above script based on your needs and it should work fine.

----------------
I hope you enjoyed this post! If you want to start a new project or you want to
add new features and maintain your old system you can hire me through
<a href="https://upwork.com/fl/al3rez" style="color: rgb(20, 168, 0);">Upwork!</a>
