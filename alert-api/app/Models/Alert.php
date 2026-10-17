<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Alert extends Model
{
    protected $fillable = ['user_id', 'symbol', 'condition', 'target_price'];

    protected function casts(): array
    {
        return [
            'target_price' => 'decimal:2',
            'triggered_at' => 'datetime',
        ];
    }
}
