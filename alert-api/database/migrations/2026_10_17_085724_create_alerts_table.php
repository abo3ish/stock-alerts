<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('alerts', function (Blueprint $table) {
            $table->id();
            // ponytail: no FK to users; users live in another service at this scale. Add one if they share a DB.
            $table->unsignedBigInteger('user_id')->index();
            $table->string('symbol', 10);
            $table->enum('condition', ['above', 'below']);
            $table->decimal('target_price', 12, 2);
            $table->enum('status', ['active', 'triggered'])->default('active');
            $table->timestamp('triggered_at')->nullable();
            $table->timestamps();

            // Cache rebuild reads "all active alerts", grouped by symbol.
            $table->index(['status', 'symbol']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('alerts');
    }
};
